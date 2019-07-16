pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract DataRegistryInterface {

    /*
     * Data Registry is a global contract for "temporary" storage.
     * It will record disputes from channels (used as evidence) and PISA will store its job there.
     */
    function getTotalShards() public returns (uint);
    function setRecord(uint _appointmentid, bytes memory _data) public returns(uint _datashard, uint _index);
    function fetchRecord(uint _datashard, address _sc,  uint _appointmentid, uint _index) public returns (bytes memory);
    function fetchRecords(uint _datashard, address _sc, uint _appointmentid) public returns (bytes[] memory);

}

contract DisputeHandlerInterface {

    // Given two disputes (and the receipt) - did we satisfy the postcondition?
    function checkJob(uint[] memory _datashard, address _sc, uint _logid, uint[] memory _dataindex, bytes[] memory _logdata, bytes memory _postcondition, address _dataregistry) public returns (uint[2] memory, bool);
}

contract PISAHash {

    // NoDeposit = contract set up, but no deposit from PISA.
    // OK = deposit in contract. ready to accept jobs.
    // CHEATED = customer has provided evidence of cheating, and deposit forfeited
    // CLOSED = PISA has shut down serves and withdrawn their coins.
    enum Flag { OK, CHEATED }

    Flag flag; // What is current state of PISA?
    uint cheatedtimer; // How long does PISA have to send customer a refund?

    // List of addresses for PISA
    mapping(address => bool) watchers;
    mapping(uint => address) disputeHandlers;
    address payable admin;
    address[] defenders;
    bool frozen;

    // Cheated record
    struct Cheated {
        address payable customer;
        uint refund;
        uint refundby;
        bool resolved;
    }

    // Customer appointment
    struct Appointment {
        address sc; // Address for external contract
        address payable cus; // Address for the customer who hired PISA
        uint startTime; // When do we start watching?
        uint finishTime; // Expiry time for appointment
        uint challengePeriod; // Length of time for the dispute/challenge
        uint appointmentid; // counter to keep track of appointments
        uint jobid; // Monotonic counter to keep track of job updates to PISA
        bytes data; // Job-specific data (depends whether it is Plasma, Channels, etc)
        uint refund; // How much should PISA refund the customer by?
        uint gas; // How much gas should PISA allocate to function call?
        uint mode; // What dispute handler should check this appointment?
        bytes eventDesc; // What event is PISA watching for?
        bytes eventVal; // Are there any index/values/id we should watch for? (Decode into distinct values)
        bytes postcondition; // If PISA was successful - what should the post-condition be?
        bytes32 h; // Customer must reveal pre-image to prove appointment is valid
    }

    // Keep a record of who was cheated.
    // Ideally, this should be small (or zero!)
    mapping(uint => Cheated) cheated;
    uint public pendingrefunds;

    // Central dispute registry
    address public dataregistry;
    address public disputeoutcome;

    // A single withdraw period for PISA (i.e. 2-3 months)
    uint public withdrawperiod;

    event PISAClosed(address watcher, uint timestamp);
    event PISACheated(address watcher, address sc, uint timestamp);
    event PISARefunded(address watcher, address cus, uint refund, uint timestamp);
    event PISARecordedResponse(address watcher, uint timestamp, uint jobid, bytes data, uint gas);

    // We have a built-in fail safe that can lock down the contract
    modifier isNotFrozen() {
      require(!frozen);
      _;
    }

    // Set up PISA with data registry, timers and the admin address.
    constructor(address _dataregistry, uint _withdrawperiod, uint _cheatedtimer, address payable _admin, address[] memory _defenders) public {
        dataregistry = _dataregistry;
        withdrawperiod = _withdrawperiod;
        cheatedtimer = _cheatedtimer;
        admin = _admin;
        defenders = _defenders; // Built-in safety feature.
    }

    // Given an apoointment, PISA will respond on behalf of the customer.
    // The function call is recorded in the DataRegistry (and timestamped).
    function respond(bytes memory _jobrequest, bytes memory _cussig) public {

        // Compute Appointment (avoid callstack issues)
        Appointment memory appointment = computeAppointment(_jobrequest);

        // Compute signature hash for this job request
        bytes32 sighash = keccak256(abi.encode(_jobrequest, address(this)));

        // Confirm the customer has signed this request!
        require(appointment.cus == recoverEthereumSignedMessage(sighash, _cussig), "Not signed by customer");

        // Only a PISA wallet can respond
        // Customer and SC addresses should have nothing to do with PISA.
        require(watchers[msg.sender], "Only watcher can send this job");

        // Emit event about our response
        emit PISARecordedResponse(appointment.sc, block.number, appointment.jobid, appointment.data, appointment.gas);

        // Make a record of our call attempt
        // Only gets stored if the transaction terminates/completes (i.e. we dont run out of gas)
        bytes memory callLog = abi.encode(block.number, appointment.jobid, appointment.gas);

        // H(sc, cus, logid) -> block number, customer address, jobid, gas
        // It will "append" this entry to the list. So if we handle the job for multiple customers,
        // it'll be appended to the list.
        uint pisaid = uint(keccak256(abi.encode(appointment.sc, appointment.cus, appointment.appointmentid)));
        DataRegistryInterface(dataregistry).setRecord(pisaid, callLog);

        // ALL GOOD! Looks like we should call the function and then store it.
        // By the way, _callData should be formatted as abi.encodeWithSignature("cool(uint256)", inputdata).
        // PISA should check before accepting job, but really it is up to customer to get this right.
        // If the function call fails, it isn't our fault.
        require(gasleft() > appointment.gas, "Sufficient gas in job request was not allocated");
        external_call(appointment.sc, 0, appointment.data.length, appointment.data, appointment.gas);

    }

    // Customer will provide sign receipt + locator to find dispute record in DataRegistry
    // PISA will look up registry to check if PISA has responded to the dispute. If so, it'll verify customer's signature and compare the jobid.
    function recourse(bytes memory _appointment, bytes[] memory _sig,  uint _r, bytes[] memory _logdata, uint[] memory _datashard, uint[] memory _dataindex) public isNotFrozen() {

        // Compute Appointment (avoid callstack issues)
        Appointment memory appointment = computeAppointment(_appointment);

        // Verify it is a ratified receipt!
        bytes32 h = keccak256(abi.encode(_r));
        require(appointment.h == h, "Wrong R" );

        // Prevent replay attacks
        // Customer ID is part of the "PISAID" so if we cheat two customers, then there are two different pisaid
        // And thus both customers can seek recourse.
        // We check if "customer" is set in cheated, if so then we've already sought recourse!
        uint pisaid = uint(keccak256(abi.encode(appointment.sc, appointment.cus, appointment.appointmentid)));
        require(cheated[pisaid].customer != appointment.cus, "Recourse was already successful");

        // Both PISA and the customer must have authorised it!
        // This is to avoid PISA faking a receipt and sending it as "recourse".
        bytes32 sighash = keccak256(abi.encode(_appointment, address(this)));
        require(watchers[recoverEthereumSignedMessage(sighash, _sig[0])], "PISA did not sign job");
        require(appointment.cus == recoverEthereumSignedMessage(sighash, _sig[1]), "Customer did not sign job");

        // Did we get the outcome we wanted?
        uint[2] memory times;
        bool outcome;

        // Make sure a dispute handler exists for this given mode!
        require(disputeHandlers[appointment.mode] != address(0), "Mode in appointment doesnt exist");

        // Returns start time / challenge period and whether everything is ok.
        // If "testdispute" fails, it should throw an exception.
        (times, outcome) = DisputeHandlerInterface(disputeHandlers[appointment.mode]).checkJob( _datashard, appointment.sc, appointment.appointmentid, _dataindex, _logdata, appointment.postcondition, dataregistry);

        // // Did PISA fail to do its job?
        require(outcome, "PISA was a good tower");

        // // Just to be safe, make sure "times" is meaningful
        require(times[0] != 0, "Sanity check start time");
        require(times[1] != 0, "Sanity check challenge period");

        // // Let's first confirm the dispute period was the "minimum" PISA agreed too.
        require(appointment.challengePeriod >= times[1], "Dispute did not satisfy min challenge period agreed");

        // // Did PISA respond within the appointment?
        require(!checkPISAResponse(appointment, times), "PISA failed post-condition, but PISA sent the job when required");

        // // PISA has cheated. Provide opportunity for PISA to respond.
        pendingrefunds = pendingrefunds + 1;
        cheated[pisaid] = Cheated(appointment.cus, appointment.refund, block.number + cheatedtimer, false);

        // Nothing to do... dispute is OK.
    }

    // Check if PISA recorded a function call for the given appointment/job
    function checkPISAResponse(Appointment memory appointment, uint[2] memory _disputeTimes) internal returns (bool) {

        // Look through every shard (should be two in practice)
        for(uint i=0; i<DataRegistryInterface(dataregistry).getTotalShards(); i++) {

            // Fetch list of PISA responses on this DataShard for the given AppointmentID
            uint pisaid = uint(keccak256(abi.encode(appointment.sc, appointment.cus, appointment.appointmentid)));

            bytes[] memory response = DataRegistryInterface(dataregistry).fetchRecords(i, address(this), pisaid);

            // It'll return a list of jobs for this given appointment (i.e. if PISA had to respond more than once)
            for(uint j=0; j<response.length; j++) {
                uint recordedJob;
                uint recordedTime;
                uint recordedGasAllocated;

                // Block number + job id recorded
                (recordedTime, recordedJob, recordedGasAllocated) = abi.decode(response[j], (uint, uint, uint));

                // Is the recorded job equal (or better) than the hired job from this receipt?
                // Did PISA respond during the challenge time
                // IMPORTANT FACTS TO CONSIDER
                // - PISA should always respond with a larger or equal Job ID
                // - PISA should always allocate gas that is greater than ALL previous appointments.
                // --> In practice - this should be a constant (i.e. 200k for resolving channel disputes)
                // --> But it is important PISA does not pick "dynamic" gas - same gas or more for a given appointmentid.
                // --> So if ALICE and BOB both hire PISA for same channel - worst case - PISA responds for twice - once for each party.
                if(recordedJob >= appointment.jobid &&
                   recordedTime >= _disputeTimes[0] && // PISA responded after dispute start time  initiated after appointment started
                   recordedTime <= _disputeTimes[0]+_disputeTimes[1] && // PISA responded within challenge period
                   recordedGasAllocated >= appointment.gas) {
                    return true;
                }
            }
        }

       // Couldn't find a PISA response
        return false;
    }

    // To avoid gas-issue, we compute the struct here.
    function computeAppointment(bytes memory _appointment) internal pure returns(Appointment memory) {
        address sc; // Address for smart contract
        address payable cus; // Address for the customer who hired PISA
        uint[3] memory timers; // [0] Start time for an appointment [1] Agreed finish time and [2] challenge period (minimum length of time for a single dispute)
        uint[2] memory appointmentinfo; // [0] Monotonic counter to keep track of appointments and [1] to keep track of job updates in PISA
        bytes[2] memory data; // [0] Job-specific data (depends whether it is Plasma, Channels, etc) and [1] is the post-condition data to check if dispute resolved as expected
        uint[3] memory extraData; // [0] Refund value to customer. [1] Gas allocated for job. [3] Dispute handler mode.
        bytes[2] memory eventData; // What event is PISA watching for?
        bytes32 h; // Customer must reveal pre-image to prove appointment is valid

        (sc,cus,timers, appointmentinfo, data, extraData, eventData, h) = abi.decode(_appointment, (address, address, uint[3], uint[2], bytes[2], uint[3], bytes[2], bytes32));
        return Appointment(sc, cus, timers[0], timers[1], timers[2], appointmentinfo[0], appointmentinfo[1], data[0], extraData[0], extraData[1], extraData[2], eventData[0], eventData[1], data[1], h);
    }

    // PISA must refund the customer before a deadline. If not, the security deposit is burnt/frozen
    function refundCustomer(uint _pisaid, address _customer) payable public {

        // Should be some refunds ready...
        require(pendingrefunds > 0, "No refunds pending");

        // Fetch cheated record.
        Cheated memory record = cheated[_pisaid];

        // Make sure it is the same customer
        require(record.customer == _customer, "Refunding wrong customer");
        require(record.refund == msg.value, "Not refunding correct value");
        require(record.refundby > block.number, "Too late to send refund!");
        require(!record.resolved, "Already refunded");

        // Lets pretend it is resolved!
        cheated[_pisaid].resolved = true; // Delete array altogether (to remove empty slots)

        // Coins deposited into contract
        // And they can now be withdrawn by the customer
        pendingrefunds = pendingrefunds - 1;

        // Yup! All records gone.
        // Our service can continue as normal
        emit PISARefunded(msg.sender, _customer, msg.value, block.number);

    }

    // Once PISA has deposited coins, the customer can withdraw it!
    function customerWithdrawRefund(uint _pisaid) payable public {

      // Only customer can withdraw the coins
      require(cheated[_pisaid].customer == msg.sender);
      require(cheated[_pisaid].resolved);

      // Send refund
      uint toRefund = cheated[_pisaid].refund;
      cheated[_pisaid].refund = 0;
      cheated[_pisaid].customer.transfer(toRefund);

    }

    // PISA hasn't refunded the customer by the desired time?
    // .... time to issue the ultimate punishment
    function forfeit(uint _pisaid, address _customer) public {

        // Sanity checking
        require(pendingrefunds > 0, "Sanity check that there are outstanding refunds");
        require(_customer != address(0), "Make sure customer has an address");

        // Fetch cheated record.
        Cheated memory record = cheated[_pisaid];

        // Did PISA resolve the cheated customer by the desired time?
        require(record.customer == _customer, "Wrong customer!"); // Make sure it is the right customer
        require(record.refundby != 0, "There must be a refund time..."); // Make sure it is not zero!!!
        require(block.number > record.refundby, "Time has passed since refund was due by PISA"); // Refund period should have expired
        require(!record.resolved, "PISA did not issue a refund"); // Has PISA resolved refund?

        flag = Flag.CHEATED;
    }

    // Install a dispute handler contract. Some off-chain protocols may slightly different,
    // This lets us deal ith their records.
    function installDisputeHandler(address _handler, uint _mode, uint _timestamp, bytes memory _sig) public {
        require(disputeHandlers[_mode] == address(0));
        require(block.number < _timestamp, "too late to install");
        // Was this signed by the cold storage key?
        bytes32 sighash = keccak256(abi.encode(_handler, _mode, _timestamp, address(this)));
        require(admin == recoverEthereumSignedMessage(sighash, _sig));

        // Install!
        disputeHandlers[_mode] = _handler;
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
    function failSafe(bytes[] memory _sig) public {

      bytes32 sighash = keccak256(abi.encode(address(this),"frozen"));

      // Every defender must agree... TODO: Change to a multi-sig.
      for(uint i=0; i<defenders.length; i++) {
        require(defenders[i] == recoverEthereumSignedMessage(sighash, _sig[i]), "Not signed by defenders address in order");
      }

      // Lock down contract and re-set flag
      frozen = true;
      flag = Flag.OK;
    }

    // Helper function
    function getFlag() public view returns(uint) {
        return uint(flag);
    }

    function getPendingRefunds() public view returns(uint) {
        return pendingrefunds;
    }

    function isWatcher(address _watcher) public view returns(bool) {
        return watchers[_watcher];
    }

    function getHandler(uint _mode) public view returns(address) {
        return disputeHandlers[_mode];
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
