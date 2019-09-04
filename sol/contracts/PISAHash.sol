pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract DataRegistryInterface {

    /*
     * Data Registry is a global contract for "temporary" storage.
     * It will record disputes from channels (used as evidence) and PISA will store its job there.
     */
    function getInterval() public pure returns (uint);
    function getTotalShards() public returns (uint);
    function setRecord(uint _appointmentid, bytes memory _data) public returns(uint _datashard, uint _index);
    function fetchRecords(uint _datashard, address _sc, uint _appointmentid) public returns (bytes[] memory);

}

contract PreconditionHandlerInterface {

    // Given particular data, is the precondition satisified?
    // Important: PISA should only call function when external contract is in a special state
    // For example, only authorise transfer if the external contract has the correct balance
    function canPISARespond(address _sc, address _cus, bytes memory _precondition) public returns(bool);
}

contract PostconditionHandlerInterface {

    // Given two disputes (and the receipt) - did we satisfy the postcondition?
    function hasPISAFailed(address _dataregistry, uint[] memory _datashard, address _sc, uint _logid, uint[] memory _dataindex, bytes[] memory _logdata, bytes memory _postcondition) public returns (bool);
}

contract ChallengeTimeDecoderInterface {
    // Decode the data and return the challenge time
    function getTime(address _dataregistry, uint[] memory _datashard, address _sc, uint _logid, uint[] memory _dataindex, bytes[] memory _logdata) public returns (uint[3] memory);
}

contract PISAHash {

    // NoDeposit = contract set up, but no deposit from PISA.
    // OK = deposit in contract. ready to accept jobs.
    // CHEATED = customer has provided evidence of cheating, and deposit forfeited
    // CLOSED = PISA has shut down serves and withdrawn their coins.
    enum Flag { OK, CHEATED }

    Flag public flag; // What is current state of PISA?
    uint public cheatedtimer; // How long does PISA have to send customer a refund?

    // List of addresses for PISA
    mapping(address => bool) public watchers;

    // Every "mode" can have a pre-condition and post-condition
    mapping(uint => bool) modeInstalled;
    mapping(uint => address) preconditionHandlers;
    mapping(uint => address) postconditionHandlers;
    mapping(uint => address) challengetimeDecoders;

    // Used to install watchers / modes. Generally its a cold-wallet.
    address payable public admin;

    // Built-in fail safe for the defenders... k-of-n
    address[] public defenders;
    uint public k;

    // We have a built-in fail safe that can lock down the contract
    bool public frozen;
    modifier isNotFrozen() {
      require(!frozen);
      _;
    }

    // Cheated record
    struct Cheated {
        uint nonce;
        uint refund;
        uint refundby;
        bool triggered;
    }

    // Customer appointment
    struct Appointment {

        // General appointment information
        address sc; // Address for external contract
        address payable cus; // Address for the customer who hired PISA
        uint startTime; // When do we start watching?
        uint finishTime; // Expiry time for appointment
        uint challengeTime; // Minimum challenge length (0 == default if not relevant)

        // Identifiers for the appointment + job counter (i.e. for every appointment, can be updated several times)
        uint appointmentid; // counter to keep track of appointments
        uint nonce; // Monotonic counter to keep track of job updates to PISA

        // Function call that we will need to invoke on behalf of the user
        bytes call; // Job-specific data (depends whether it is Plasma, Channels, etc)
        uint refund; // How much should PISA refund the customer by?
        uint gas; // How much gas should PISA allocate to function call?
        uint mode; // What dispute handler should check this appointment?

        // What pre and post condition should be satisified? (Optional)
        bytes precondition; // What condition should be satisified before call can be executed?
        bytes postcondition; // If PISA was successful - what should the post-condition be?
        bytes32 h; // Customer must reveal pre-image to prove appointment is valid
    }

    // Keep a record of who was cheated.
    // Ideally, this should be small (or zero!)
    mapping(uint => Cheated) public cheated;
    mapping(address => uint) public refunds;
    uint public pendingrefunds;

    // Did customer try to maliciously hurt PISA? Refund PISA their bond.
    uint public challengeBond;

    // Data registry for looking up the logs
    address public dataregistry;

    event PISARefunded(address watcher, address cus, uint refund, uint timestamp);
    event PISARecordedResponse(uint pisad, address watcher, uint timestamp, uint gas, bytes data);

    // Set up PISA with data registry, timers and the admin address.
    constructor(address _dataregistry, uint _cheatedtimer, uint _challengeBond, address payable _admin, address[] memory _defenders, uint _k) public {
        dataregistry = _dataregistry;
        cheatedtimer = _cheatedtimer;
        challengeBond = _challengeBond;
        admin = _admin;
        defenders = _defenders;
        k = _k;

        require(defenders.length >= k);// Built-in sanity check
    }

    // Given an apoointment, PISA will respond on behalf of the customer.
    // The function call is recorded in the DataRegistry (and timestamped).
    function respond(bytes memory _appointment, bytes memory _cussig) public {
        // Only a PISA wallet can respond
        // Customer and SC addresses should have nothing to do with PISA.
        require(watchers[msg.sender], "Only watcher can send this job");

        // Fetch appointment signed by the customer
        Appointment memory appointment = computeAppointment(_appointment);
        bytes32 sighash = keccak256(abi.encode(_appointment, address(this)));
        require(appointment.cus == recoverEthereumSignedMessage(sighash, _cussig), "PISA response cancelled as customer did not authorise this job");

        // Sometimes PISA should only respond if some condition is satisified
        // - If it fails by returning "false", then PISA shouldn't respond
        // - If it fails by throwing an exception, then PISA should try and respond
        // TODO: Change from function in solidity to external_call approach
        if(preconditionHandlers[appointment.mode] != address(0)) {
            require(PreconditionHandlerInterface(preconditionHandlers[appointment.mode]).canPISARespond(appointment.sc, appointment.cus, appointment.precondition));
        }

        // Keep a timestamp of when we tried to call + the nonce.
        // Nonce lets us do a quick sanity check later if PISA sent latest job
        bytes memory callLog = abi.encode(block.number, appointment.nonce, keccak256(_appointment));

        // We need the PISAID in order to quickly look it up during recourse.
        uint pisaid = uint(keccak256(abi.encode(appointment.sc, appointment.cus, appointment.appointmentid)));
        DataRegistryInterface(dataregistry).setRecord(pisaid, callLog);

        // Emit event about our response
        emit PISARecordedResponse(pisaid, msg.sender, block.number, appointment.gas, appointment.call);

        // ALL GOOD! Looks like we should call the function and then store it.
        // By the way, _callData should be formatted as abi.encodeWithSignature("cool(uint256)", inputdata).
        // PISA should check before accepting job, but really it is up to customer to get this right.
        // If the function call fails, it isn't our fault.
        require(gasleft() > appointment.gas, "Sufficient gas in job request was not allocated");
        external_call(appointment.sc, 0, appointment.call.length, appointment.call, appointment.gas);

    }

    // Customer will provide sign receipt + locator to find dispute record in DataRegistry
    // PISA will look up registry to check if PISA has responded to the dispute. If so, it'll verify customer's signature and compare the nonce.
    function recourse(bytes memory _appointment, bytes[] memory _sig,  uint _r, bytes[] memory _logdata, uint[] memory _datashard, uint[] memory _dataindex) public payable isNotFrozen() {

        // Customer must put down a bond to issue recourse
        // In case PISA didn't cheat... prevent griefing
        require(msg.value == challengeBond, "Bad challenge bond");

        // Compute Appointment (avoid callstack issues)
        Appointment memory appointment = computeAppointment(_appointment);

        // Confirm the "mode" in appointment is installed
        // We should reserve a special number "20201225" for "cancelled job"
        require(modeInstalled[appointment.mode], "Mode is not installed");

        // Verify it is a ratified receipt!
        bytes32 h = keccak256(abi.encode(_r));
        require(appointment.h == h, "Wrong R" );

        // PISA's log will eventually disappear. So the customer needs to seek recourse
        // within the "disappear" time period. This is set by the DataRegistry.
        // (of course, if we kept logs around forever, this wouldn't be an issue,
        // but then we bloat the network and we are bad citizens to the world,
        // this is ok though since logs should be around for 50,100+ days)
        require(appointment.startTime + DataRegistryInterface(dataregistry).getInterval() > block.number, "PISA log is likely deleted, so unfair to seek recourse");
        require(block.number > appointment.finishTime, "PISA still has time to finish the job"); // Give or take, could be end of dispute time, but easier here.

        // Prevent replay attacks
        // Every PISAID is unique to a customer's appointment.
        // Care must be taken, if two customers hire us for the same job, then we need to respond twice (if postcondition fails)
        uint pisaid = uint(keccak256(abi.encode(appointment.sc, appointment.cus, appointment.appointmentid)));
        require(appointment.nonce > cheated[pisaid].nonce, "Recourse was already successful");

        // Both PISA and the customer must have authorised it!
        // This is to avoid PISA faking a receipt and sending it as "recourse"
        // With a "lower" refund amount!
        bytes32 sighash = keccak256(abi.encode(_appointment, address(this)));
        require(watchers[recoverEthereumSignedMessage(sighash, _sig[0])], "PISA did not sign job");
        require(appointment.cus == recoverEthereumSignedMessage(sighash, _sig[1]), "Customer did not sign job");

        // Was there a post-condition in the contract that should be satisified?
        if(postconditionHandlers[appointment.mode] != address(0)) {

          // Yes... lets see if PISA was a good tower and the condition is satisified
          // Results "TRUE" is PISA failed to do its job
          bool outcome;
          (outcome) = PostconditionHandlerInterface(postconditionHandlers[appointment.mode]).hasPISAFailed(dataregistry, _datashard, appointment.sc, appointment.appointmentid, _dataindex, _logdata, appointment.postcondition);

          // Did PISA fail to do its job?
          require(outcome, "PISA was a good tower");
        }

        // Get the time window to check if PISA responded
        // [start time, finish time, challenge period]
        uint[3] memory timewindow;

        // Is there a challenge period?
        if(challengetimeDecoders[appointment.mode] != address(0)) {

          // We'll need to "decode" the log and fetch the start/end time from it.
          (timewindow) = ChallengeTimeDecoderInterface(challengetimeDecoders[appointment.mode]).getTime(dataregistry, _datashard, appointment.sc, appointment.appointmentid, _dataindex, _logdata);

          // Time to perform some sanity checks
          require(timewindow[2] >= appointment.challengeTime, "Contract did not abide by minimum challenge time");  // Finish time - start time >= minimum challenge time
          require(timewindow[1] - timewindow[0] >= appointment.challengeTime, "Timestamps for start/end of dispute is (somehow) less than challenge time"); // Sanity check (hopefully prevent a bug)
          require(timewindow[0] >= appointment.startTime, "Dispute started before appointment time...."); // Start time of challenge must be after appointment start time
          require(timewindow[0] < appointment.finishTime, "Dispute started after appointment time..."); // Challenge must have been triggered BEFORE we stopped watching
          // No check for timewindow[2] > appointment.finishTime.
          // We only care about when it "started" and that the "min challenge time" is reasonable.
        } else {
           timewindow = [appointment.startTime, appointment.finishTime, 0];
        }

        // Make sure the values are set to something meaningful
        require(timewindow[0] > 0 && timewindow[1] > 0, "Timing information is not meaningful");

        // Here we check if PISA has responded...
        // Lots of things may have happened (i.e. new appointment is completely different to old one)
        require(!didPISARespond(pisaid, appointment.nonce, keccak256(abi.encode(appointment)), timewindow), "PISA sent the right job during the appointment time");

        // PISA has cheated. Provide opportunity for PISA to respond.
        // Of course... customer may send multiple appointments where PISA failed...
        // We only take into account the log with the largest nonce... and increment
        // pending refund once!
        if(!cheated[pisaid].triggered) {
          pendingrefunds = pendingrefunds + 1;
        }

        cheated[pisaid] = Cheated(appointment.nonce, appointment.refund + challengeBond, block.number + cheatedtimer, true);
    }

    // Check if PISA recorded a function call for the given appointment/job
    function didPISARespond(uint _pisaid, uint _nonce, bytes32 _expectedHash, uint[3] memory _timewindow) internal returns (bool) {

        // Look through every shard (should be two in practice)
        for(uint i=0; i<DataRegistryInterface(dataregistry).getTotalShards(); i++) {

            // [timestamp, nonce, Hash(appointment)]
            bytes[] memory response = DataRegistryInterface(dataregistry).fetchRecords(i, address(this), _pisaid);

            // It'll return a list of jobs for this given appointment (i.e. if PISA had to respond more than once)
            for(uint j=0; j<response.length; j++) {
                uint nonce;
                uint recordedTime;
                bytes32 recordedHash;

                // Block number + nonce recorded
                (recordedTime, nonce, recordedHash) = abi.decode(response[j], (uint, uint, bytes32));

                // A future nonce was used? Will be all good... appointment may be completely different
                if(nonce >= _nonce) { return true; }

                // It must meaningful
                require(recordedTime != 0);

                // PISA should respond between the start time and finish time
                // _timewindow[0] -> recordedTime <- _timewindow[1]
                //
                // We should also find the exact same AppointmentHash :) if so nonce is good too
                if(recordedTime >= _timewindow[0] && // Did PISA respond after the start time?
                   recordedTime <= _timewindow[1] &&
                   recordedHash == _expectedHash) {
                   return true;
                }
            }
        }

       // Couldn't find a PISA response
        return false;
    }

    // To cancel an appointment, just need to sign a larger nonce with mode=496 (perfect number)
    // Customer may send older (and cancelled) appointment via recourse... PISA can just respond
    // with the cancelled receipt and claim the bond :)
    function cancelledAppointment(bytes memory _appointment, bytes memory _cussig) public {
      // TODO: It doesn't look like we need this check (anything bad can happen if customer sets nonce too large?
      // I don't think so.... will just cancel their own refund lol
      // require(watchers[msg.sender] || admin == msg.sender, "Only PISA can call it");

      // Compute Appointment (avoid callstack issues)
      Appointment memory appointment = computeAppointment(_appointment);

      // Check signature
      bytes32 sighash = keccak256(abi.encode(_appointment, address(this)));
      require(appointment.cus == recoverEthereumSignedMessage(sighash, _cussig), "Customer did not sign job");

      // Compute PISAID
      uint pisaid = uint(keccak256(abi.encode(appointment.sc, appointment.cus, appointment.appointmentid)));

      // Is the nonce here larger than the cheat log?
      require(appointment.nonce > cheated[pisaid].nonce, "PISA submitted an older appointment");

      // OK we can remove cheat log and give PISA the bond
      refunds[admin] = refunds[admin] + challengeBond;

      // Update cheat log + pending refunds accordingly
      cheated[pisaid].nonce = appointment.nonce;
      cheated[pisaid].triggered = false; // No longer triggered!
      cheated[pisaid].refund = 0;
      cheated[pisaid].refundby = 0;
      pendingrefunds = pendingrefunds - 1;

    }

    // To avoid gas-issue, we compute the struct here.
    function computeAppointment(bytes memory _appointment) internal pure returns(Appointment memory) {

        bytes memory appointmentinfo;
        bytes memory contractinfo;
        bytes memory conditions;

        (appointmentinfo, contractinfo, conditions) = abi.decode(_appointment, (bytes, bytes, bytes));
        Appointment memory appointment;

        // Get appointment information
        // [appointmentid, nonce, startTime, endTime, challengeTime, refund, h]
        (appointment.appointmentid, appointment.nonce, appointment.startTime, appointment.finishTime, appointment.challengeTime, appointment.refund, appointment.h) = abi.decode(appointmentinfo, (uint, uint, uint, uint, uint, uint, bytes32));

        // Get contract information
        // [sc, cus, gas, calldata]
        (appointment.sc, appointment.cus, appointment.gas, appointment.call) = abi.decode(contractinfo, (address, address, uint, bytes));

        // Get events and postcondition data
        // [eventDesc, eventArgs, precondition, postcondition, mode]
        // We ignore the "event" information in the contract for now.
        // TODO: It should be doable to combine both evnets + conditions. Keeping separate for now.
        (,,appointment.precondition, appointment.postcondition, appointment.mode) = abi.decode(conditions, (bytes, bytes, bytes, bytes, uint));

        return appointment;
    }

    // PISA must refund the customer before a deadline. If not, the security deposit is burnt/frozen
    function refundCustomer(address _sc, address _cus, uint _appointmentid) payable public {

        // Should be some refunds ready...
        require(pendingrefunds > 0, "No refunds pending");
        uint pisaid = uint(keccak256(abi.encode(_sc, _cus, _appointmentid)));

        // Fetch cheated record.
        Cheated memory record = cheated[pisaid];

        // Make sure coins sent to contract matches up with the refund amount
        // Note we don't really who care who issues refund - as long as it is refunded.
        require(record.refund == msg.value, "PISA must refund the exact value");
        require(record.triggered, "Cheating record must still be triggered");

        // All good! Let's update our state
        cheated[pisaid].triggered = false; // No longer triggered!
        cheated[pisaid].refund = 0;
        cheated[pisaid].refundby = 0;
        refunds[_cus] = refunds[_cus] + msg.value; // Increment how much we owe the customer
        pendingrefunds = pendingrefunds - 1;

        // Yup! All records gone.
        // Our service can continue as normal
        emit PISARefunded(msg.sender, _cus, msg.value, block.number);

    }

    // Once PISA has deposited coins, the customer can withdraw it!
    // All must be withdrawan at once... should avoid potential replay (i.e. if A sends 10 refunded coins to B and 10 refunded coins to C, then C can replay message twice)
    function withdraw(address payable _receiver, uint _amount, uint _blockstamp, address _customer, bytes memory _cussig) payable public {
        require(_amount == refunds[_customer]); // Make sure the customer has sufficient balance
        require(_blockstamp > block.number - 100 && block.number + 100 > _blockstamp); // blockno - 100 -> timestamp <- blockno + 100 (200 block window)

        bytes32 h = keccak256(abi.encode(_receiver, _amount, _blockstamp, address(this)));
        address signer = recoverEthereumSignedMessage(h, _cussig);
        require(signer == _customer, "Customer did not authorise this withdrawal");

        // Perform the transfer
        uint bal = refunds[_customer];
        refunds[_customer] = 0;
        _receiver.transfer(bal);
    }

    // PISA hasn't refunded the customer by the desired time?
    // .... time to issue the ultimate punishment
    function forfeit(uint _pisaid) public isNotFrozen {

        // Sanity checking
        require(pendingrefunds > 0, "Sanity check that there are outstanding refunds");

        // Fetch cheated record.
        require(cheated[_pisaid].triggered, "Cheat log should be triggered!");
        require(cheated[_pisaid].refund != 0, "There must be a balance to refund");
        require(cheated[_pisaid].refundby != 0, "There must be a refund time..."); // Make sure it is not zero!!!
        require(block.number > cheated[_pisaid].refundby, "Time has not yet passed since refund was due by PISA"); // Refund period should have expired

        // Remove record (just in case contract is re-activated in future by failsafe)
        cheated[_pisaid].triggered = false;
        cheated[_pisaid].refund = 0;
        cheated[_pisaid].refundby = 0;

        // PISA has cheated... flag it... shuts everything down.
        flag = Flag.CHEATED;
    }

    // Install a dispute handler contract. Some off-chain protocols may slightly different,
    // This lets us deal ith their records.
    function installMode(address _precondition, address _postcondition, address _challengetimeDecoder, uint _mode, uint _timestamp, bytes memory _sig) public {
        require(preconditionHandlers[_mode] == address(0), "Precondition must not already be installed");
        require(postconditionHandlers[_mode] == address(0), "Postcondition must not already be installed");
        require(challengetimeDecoders[_mode] == address(0), "Challenge Time Decoder must not already be installed");
        require(!modeInstalled[_mode], "Mode must not already be installed");
        require(_timestamp > block.number, "too late to install");

        // Was this signed by the cold storage key?
        bytes32 sighash = keccak256(abi.encode(_precondition, _postcondition, _challengetimeDecoder, _mode, _timestamp, address(this)));
        require(admin == recoverEthereumSignedMessage(sighash, _sig), "Bad installation signature from PISA");

        // Install handlers!
        preconditionHandlers[_mode] = _precondition;
        postconditionHandlers[_mode] = _postcondition;
        challengetimeDecoders[_mode] = _challengetimeDecoder;
        modeInstalled[_mode] = true; // finally installed!
    }

    // Install a watcher address who is authorised to sign appointments.
    function installWatcher(address _watcher, uint _timestamp, bytes memory _sig) public {

        // Watcher should be installed before a given time...
        require(!watchers[_watcher], "already installed");
        require(block.number < _timestamp, "too late to install");

        // Was this signed by the cold storage key?
        bytes32 sighash = keccak256(abi.encode(_watcher, _timestamp, address(this)));
        require(admin == recoverEthereumSignedMessage(sighash, _sig), "bad signature install watcher");

        // Install watcher
        watchers[_watcher] = true;
    }

    /*
     * While PISA remains a young project, there is a potential for devastating smart contract bugs
     * that can be used against us to forfeit the security deposit. We don't want to face the same fate
     * as the parity wallet, the dao, etc. Especially if we have acted honestly as a company.
     *
     * We have entrusted the following people to 'evaluate' the situation:
     * Name1, Name2, Name3
     *
     * If the PISA contract breaks down (and the security deposit is "burnt"), then the individuals will judge the situation.
     * - Did PISA break down because of an unforseen smart contract bug?
     * - Did PISA, honestly, respond to all jobs as it was hired to do?
     * - Did the attacker discover a bug at the API (external to smart contract) to forge receipts and try to kill PISA?
     *
     * Generally, if PISA has acted honest and software bugs beat us, then the individuals can unlock the funds. If PISA
     * was DISHONEST and simply refused to respond to a job. Then the individuals are compelled NOT to unlock the funds.
     * It is hard to foresee the future cases, but the principle of "do not be evil" should be used here.
     *
     * What does it do? Flag = OK and disables the "recourse" function.
     */
    function failSafe(bytes[] memory _sigs, uint[] memory _coldstorageindex) public {

      // All distributed members should sign the same message.
      bytes32 h = keccak256(abi.encode(address(this),"frozen"));

      // Verify cold storage signed cance request.
      require(checkKofN(k, h, _sigs, _coldstorageindex), "Verifying K of N signatures failed");

      // Lock down contract and re-set flag
      frozen = true;
      flag = Flag.OK;
    }

    // Verify that K of N cold storage keys signed a message
    function checkKofN(uint _k, bytes32 _h, bytes[] memory _signatures, uint[] memory _coldstorageindex) public view returns (bool) {

        // We need exactly "k" signatures
        require(_k == _signatures.length, "k != sigs");
        require(_k == _coldstorageindex.length, "k != coldstorage indexes");

        // Confirm there are no duplicates!
        // i.e. we will check at least "k" signing keys
        checkForDuplicates(_coldstorageindex);

        // Check all signatures
        for(uint i=0; i<_coldstorageindex.length; i++) {
            address signer = defenders[_coldstorageindex[i]];
            require(signer == recoverEthereumSignedMessage(_h, _signatures[i]), "Bad signer in multisig");
        }

        // All good ^^
        return true;

    }

    // Useful for the k-of-n signature validation
    function checkForDuplicates(uint[] memory _list) internal pure returns (bool) {

        // Quickly checks for duplicates
        for(uint i=0; i<_list.length; i++) {
            for(uint j=i+1; j<_list.length; j++) {
                require(_list[i] != _list[j], "List of indexes are NOT unique");
            }
        }
    }
    function getMode(uint _mode) public view returns(address[3] memory, bool) {
        return ([preconditionHandlers[_mode],postconditionHandlers[_mode],challengetimeDecoders[_mode]], modeInstalled[_mode]);
    }

    // Borrow from Gnosis. Let's us perform a call in assembly.
    // Why the assembly call? if the call fails i.e. exception thrown by require or assert - it'll be caught here and returns false.
    function external_call(address destination, uint value, uint dataLength, bytes memory data, uint totalGas) internal returns (bool) {
        bool result;
        assembly {
            let x := mload(0x40)   // "Allocate" memory for output (0x40 is where "free memory" pointer is stored by convention)
            let d := add(data, 32) // First 32 bytes are the padded length of data, so exclude that
            result := call(
                totalGas, // totalGas will be is the value that solidity is currently emitting
                destination,
                value,
                d,
                dataLength,        // Size of the input (in bytes) - this is what fixes the padding problem
                x,
                0                  // Output is ignored, therefore the output size is zero
            )
        }
        return result;
    }

    // Placeholder for now to verify signed messages from PISA.
    function recoverEthereumSignedMessage(bytes32 _hash, bytes memory _signature) public pure returns (address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, _hash));
        return recover(prefixedHash, _signature);
    }


    // Recover signer's address
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
