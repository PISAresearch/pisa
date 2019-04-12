pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract DataRegistryInterface {

    /*
     * Dispute Registry is a dedicated global contract for
     * recording state channel disputes.
     * If a state channel has recorded too many disputes, we'll run out of gas, but this is unlikely due to time to resolve each dispute.
     */

    // Test dispute. Day is 0-6 (depending on daily record).
    function fetchRecords(address _sc, uint _datashard) public returns (bytes[] memory);
}

contract PISA {

    // Simply stores deposit and waits on evidence of cheating from customer.
    // Note: This implementation relies on "timestamps" and not "block time".

    // NoDeposit = contract set up, but no deposit from PISA.
    // OK = deposit in contract. ready to accept jobs.
    // CHEATED = customer has provided evidence of cheating, and deposit forfeited
    // CLOSED = PISA has shut down serves and withdrawn their coins.
    enum Flag { NODEPOSIT, OK, CHEATED, CLOSING, CLOSED }

    struct Watcher {
        Flag flag;
        uint withdrawtime; // What is the exact time PISA can withdraw deposit?
        uint deposit; // Current security deposit?
    }

    // List of PISA-compatible watchers
    mapping(address => Watcher) watchers;

    // Central dispute registry
    address public dataregistry;

    // All watchers are forced to use same withdraw period (i.e. 2-3 months)
    uint public withdrawperiod;

    // Inform world the tower has deposited coins.
    event PISADeposit(address watcher, uint coins, uint timestamp);
    event PISAClosing(address watcher, uint withdrawtime, uint timestamp);
    event PISAClosed(address watcher, uint timestamp);
    event PISACheated(address watcher, address SC, uint timestamp);


    // Set up timers for PISA. No deposit yet.
    // Two step process. Set timers, send deposit seperately.
    constructor(address _dataregistry, uint _withdrawperiod) public {
        dataregistry = _dataregistry;
        withdrawperiod = _withdrawperiod;
    }

    // Accept deposit from PISA and set up contract .
    // Can be re-used to topup deposit while channel is on
    function sendDeposit() public payable {

        // We can only submit a deposit (while there is no deposit or flag is OK)
        require(watchers[msg.sender].flag == Flag.NODEPOSIT || watchers[msg.sender].flag == Flag.OK);
        require(msg.value > 0);
        watchers[msg.sender].flag = Flag.OK;
        watchers[msg.sender].deposit = watchers[msg.sender].deposit + msg.value;

        emit PISADeposit(msg.sender,msg.value,block.timestamp);
    }

    // PISA wants to shut down.
    function stopmonitoring() public {
        // A watcher can only stop monitoring while operational
        require(watchers[msg.sender].flag == Flag.OK);

        // Kick-start process of letting watcher get their deposit back
        watchers[msg.sender].withdrawtime = block.timestamp + withdrawperiod;
        watchers[msg.sender].flag = Flag.CLOSING;

        // Tell the world
        emit PISAClosing(msg.sender, watchers[msg.sender].withdrawtime, block.timestamp);
    }

    // Let PISA withdraw deposit after time period
    function withdraw() public {
        require(watchers[msg.sender].flag == Flag.CLOSING, "Flag is not closing");
        require(block.timestamp >= watchers[msg.sender].withdrawtime, "Must wait longer");

        // Safe from recusion - due to flag being CLOSED.
        watchers[msg.sender].flag = Flag.CLOSED;
        uint deposit = watchers[msg.sender].deposit;
        watchers[msg.sender].deposit = 0;
        msg.sender.transfer(deposit);

        // Tell everyone PISA has shut down
        emit PISAClosed(msg.sender,block.timestamp);
    }

    /*
     * Signed message from PISA during appointment:
     * - starttime = Start time of appointment
     * - expry = End time of appointment
     * - SC = Address of state channel smart contract
     * - i = State Version (i.e. what counter the tower agreed to publish)
     * - h = Conditional transfer hash (i.e. computed by tower)
     * - s = Conditional transfer pre-image (i.e. prove Tower has been paid)
     * - addr = address(this) is this contract's address.
     * ------- We also require it to be signed! --------
     * - signature = watcher signature
     * - watcher = watcher address
     */
    function recourse(uint _channelmode, uint _starttime, uint _expiry, address _SC, uint _version, bytes32 _h, uint _s, bytes memory _signature, address _watcher, uint _datashard) public returns (bool){

        // Watcher MUST have a deposit in our contract for flag == OK.
        require(watchers[_watcher].flag == Flag.OK || watchers[_watcher].flag == Flag.CLOSING, "Can only seek recourse if watcher service is active");
        require(_h == keccak256(abi.encodePacked(_s)), "Secret _s did not match receipt h = H(s)"); // Hash should match up
        require(_expiry > _starttime, "Invalid expiry and starttime"); // Time periods in receipt should be valid

        // Compute hash signed by the tower
        require(_watcher == recoverEthereumSignedMessage(keccak256(abi.encodePacked(_channelmode, _starttime, _expiry, _SC, _version, _h, address(this))), _signature), "Receipt is not signed by this watcher");

        // Look up dispute registry to test signed receipt.
        bytes[] memory disputes = DataRegistryInterface(dataregistry).fetchRecords(_SC, _datashard);

        // Go through each recorded dispute and check if PISA should have responded!
        for(uint i=0; i<disputes.length; i++) {

            if(testDispute(disputes[i], _channelmode, _starttime, _expiry, _version)) {

                watchers[_watcher].flag = Flag.CHEATED;
                emit PISACheated(_watcher, _SC, block.timestamp);
                return true;
            }
        }

        return false;
    }


    // Can verify command and closure disputes
    function testDispute(bytes memory _dispute, uint _channelmode, uint _starttime, uint _expiry, uint _version) pure returns(bool) {

        uint dStarttime;
        uint dExpiry;
        uint dVersion;

        (dStarttime,dExpiry,dVersion) = abi.decode(_dispute,(uint, uint, uint));

        if(dStarttime >= _starttime && _expiry >= dExpiry) {

            // We consider CLOSURE disputes
            // Records:
            // _i = 11, rec.round = 10, true (PISA had 11, state 10 was accepted, bad!)
            // _i = 10, rec.round = 10, false. (PISA had 10, state 10 was accepted, good!)
            // _i = 9, rec.round = 10, false (PISA had 9, state 10 was accepted, good!)
            // This is becuase the dispute only stores latest version,
            // Disputes do NOT increment the version.
            if(_channelmode == 0 && _version > dVersion) {
                return true;
            }

            // We consider COMMAND disputes
            // Records:
            // _i = 11, rec.round = 10, true (PISA had 11, state 9 was used for transition, bad)
            // _i = 10, rec.round = 10, true (PISA had 10, state 9 was used for transition, bad)
            // _i = 9, rec.round = 10, false. (PISA had 9, state 9 was used for transition, good)
            // This is because the dispute transitions version from i to i+1
            if(_channelmode == 1 && _version >= dVersion) {
                return true;
            }
        }

        return false;
    }

    // Placeholder for now to verify signed messages from PISA.
    function recoverEthereumSignedMessage(bytes32 _hash, bytes memory _signature) public pure returns (address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, _hash));
        return recover(prefixedHash, _signature);
    }

    // Helper function
    function getDepositBalance(address _watcher) public view returns(uint) {
        return watchers[_watcher].deposit;
    }

    function getFlag(address _watcher) public view returns(uint) {
        return uint(watchers[_watcher].flag);
    }

    /********* ********* *********
    * Code for verifying signatures
    ********** ********* ********* */

    function recover(bytes32 _hash, bytes memory _signature) internal pure returns (address) {
      bytes32 r;
      bytes32 s;
      uint8 v;

      // Check the signature length
      if (_signature.length != 65) {
          return (address(0));

      }

      // Divide the signature in r, s and v variables
      // ecrecover takes the signature parameters, and the only way to get them
      // currently is to use assembly.
      // solium-disable-next-line security/no-inline-assembly

      assembly {
          r := mload(add(_signature, 32))
          s := mload(add(_signature, 64))
          v := byte(0, mload(add(_signature, 96)))

      }

      // Version of signature should be 27 or 28, but 0 and 1 are also possible versions
      if (v < 27) {
          v += 27;
      }

      // If the version is correct return the signer address
      if (v != 27 && v != 28) {
          return (address(0));

      } else {
          // solium-disable-next-line arg-overflow
          return ecrecover(_hash, v, r, s);
      }
    }
}
