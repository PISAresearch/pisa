pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;
import "./EventStorage.sol";


// 1 there is a merkle tree of ownsership
// a) we rollup transactions - in this we dont need to watch on chain
// b) we dont roll up transactions - now we need to watch on chain for exits on this coin
// c)

contract DataRegistryInterface {

    /*
     * Data Registry is a global contract for "temporary" storage.
     * It will record disputes from channels (used as evidence) and PISA will store its job there.
     */
    function getInterval() public pure returns (uint);
    function getTotalShards() public returns (uint);
    function setRecord(bytes32 _appointmentid, bytes memory _data) public returns(uint _datashard, uint _index);
    function fetchRecords(uint _datashard, address _sc, bytes32 _appointmentid) public returns (bytes[] memory);

}

contract EventStorage {
    function storeEvent(address emitter, byte32[4] topics, bytes data) public {
        

    }

}

// contract PreconditionHandlerInterface {

//     // Given particular data, is the precondition satisified?
//     // Important: PISA should only call function when external contract is in a special state
//     // For example, only authorise transfer if the external contract has the correct balance
//     function canPISARespond(address _sc, address _cus, bytes memory _precondition) public returns(bool);
// }

// contract PostconditionHandlerInterface {

//     // Given two disputes (and the receipt) - did we satisfy the postcondition?
//     function hasPISAFailed(address _dataregistry, uint[] memory _datashard, address _sc, bytes32 _logid, uint[] memory _dataindex, bytes[] memory _logdata, bytes memory _postcondition) public returns (bool);
// }

// contract ChallengeTimeDecoderInterface {
//     // Decode the data and return the challenge time
//     function getTime(address _dataregistry, uint[] memory _datashard, address _sc, bytes32 _logid, uint[] memory _dataindex, bytes[] memory _logdata) public returns (uint[3] memory);
// }

contract MultiChannelTriggerChecker {
    // function fetchFromDr(bytes32 pisaId) {
    //     for(uint i = 0; i < DataRegistryInterface(dataregistry).getTotalShards(); i++) {
    //         bytes[] memory dataRegistryItems = DataRegistryInterface(dataregistry).fetchRecords(i, address(this), pisaId);

    //         // It'll return a list of jobs for this given appointment (i.e. if PISA had to respond more than once)
    //         for(uint j = 0; j<dataRegistryItems.length; j++) {
    //         }
    //     }
    // }
    function verify(EventInfo trigger, bytes memory triggerData) public returns(bool) {
        bytes32 triggerExpectedHash = trigger.topics[3];
        return (keccak256(triggerData) == triggerExpectedHash);
    }

    function occurred(uint blockObserved, EventInfo trigger, uint startBlock, uint endBlock) public returns (bool) {
        // is the specified block
        require(blockObserved >= startBlock, "Event trigger before start block.");
        require(blockObserved <= endBlock, "Event trigger after end block.");

        address dataRegistry = trigger.location;
        bytes32 triggerEventName = trigger.topics[0];
        require(
            keccak256(abi.encode("NewHash(uint, address indexed, bytes32 indexed, uint, bytes, bytes32 indexed)")) == triggerEventName,
            "New hash events must encode the NewHash event as the first topic."
        );
        address triggerAddress = address(bytes20(tigger.topics[1]));
        bytes32 triggerId = trigger.topics[2];
        bytes32 triggerExpectedHash = trigger.topics[3];

        uint shardIndex = DataRegistry(dataRegistry).getDataShardIndex(blockObserved);
        bytes[] memory dataRegistryItems = DataRegistry(dataregistry).fetchHashes(shardIndex, triggerAddress, triggerId);

        // It'll return a list of jobs for this given appointment (i.e. if PISA had to respond more than once)
        for(uint j = 0; j<dataRegistryItems.length; j++) {
            if(dataRegistryItems[j] == triggerExpectedHash) {
                return true;
            }
        }
    }

    function occurred2(DataLog log, uint startBlock, uint endBlock) public returns(bool) {
        bytes32 dataHash = DataRegistry(dataRegistry).fetchHash(log.shard, log.loggingAddress, log.id, log.index);
        require(dataHash == keccak256(log.data), "Log data does not match data registry data.");

        (uint triggerMsg, uint blockNumber, uint challengerPeriod, uint vState) = abi.decode(log.data, (uint, uint, uint, uint));

        require(triggerMsg == 0, "Log entry is not a trigger.");
        require(blockNumber >= startBlock, "Trigger block number was before start block.");
        require(blockNumber <= endBlock, "Trigger block number was after end block.");

        // unwrap the event data...?

        // could validate the challenge period here, but may not be necessary?
        //require(challengePeriod???? <= endBlock, "Trigger block number was after end block.");

        // v should be equal to one in the response shouldnt it? no, it should equal the one in the trigger data, no the whole thing will?
        // require(vState )


    }
}

contract FailureStateChecker {
    function occurred(
        DataLog triggerData,
        DataLog failureData,
        uint startBlock,
        uint responsePeriod
    ) public returns (bool) {
        (uint triggerMsg, , , uint startV) = abi.decode(triggerData, (uint, uint, uint, uint));
        (uint resolveMsg, uint blockNumber, uint finalV) = abi.decode(failureData, (uint, uint, uint));

        require(triggerMsg == 0, "Incorrect trigger log format.");
        require(resolveMsg == 1, "Incorrect resolve log format.");
        // an event was triggered, and a resolve did occur
        // in this case the resolve should increment the start v by one
        require(startV+1 == finalV, "Final v state should only increment by 1.");

        require(blockNumber >= startBlock, "Resolve occurred before the trigger occurred.");
        require(blockNumber <= (startBlock + responsePeriod), "Resolve occurred after the trigger + response period had expired.");
    }
}


contract MultiChannelResponseResultChecker {
    // function fetchFromDr(bytes32 pisaId) {
    //     for(uint i = 0; i < DataRegistryInterface(dataregistry).getTotalShards(); i++) {
    //         bytes[] memory dataRegistryItems = DataRegistryInterface(dataregistry).fetchRecords(i, address(this), pisaId);

    //         // It'll return a list of jobs for this given appointment (i.e. if PISA had to respond more than once)
    //         for(uint j = 0; j<dataRegistryItems.length; j++) {
    //         }
    //     }
    // }

    function occurred(address channelContract, bytes32 id, uint v) public returns (bool) {
        // is the specified block
        // get all items with the correct response data

        // go to the specified address and check that v > than the one supplied
        // now we do need a mode? or just execute those bytes?
        //(bool success, bytes response) = channelContract.call(id);
        //



        require(blockObserved >= startBlock, "Event trigger before start block.");
        require(blockObserved <= endBlock, "Event trigger after end block.");

        address dataRegistry = trigger.location;
        bytes32 triggerEventName = trigger.topics[0];
        require(
            keccak256(abi.encode("NewHash(uint, address indexed, bytes32 indexed, uint, bytes, bytes32 indexed)")) == triggerEventName,
            "New hash events must encode the NewHash event as the first topic."
        );
        address triggerAddress = address(bytes20(tigger.topics[1]));
        bytes32 triggerId = trigger.topics[2];
        bytes32 triggerExpectedHash = keccak256(logData);

        uint shardIndex = DataRegistry(dataRegistry).getDataShardIndex(blockObserved);
        bytes[] memory dataRegistryItems = DataRegistry(dataregistry).fetchHashes(shardIndex, triggerAddress, triggerId);

        // It'll return a list of jobs for this given appointment (i.e. if PISA had to respond more than once)
        for(uint i = 0; i < DataRegistryInterface(dataregistry).getTotalShards(); i++) {
            bytes[] memory dataRegistryItems = DataRegistryInterface(dataregistry).fetchRecords(i, address(this), pisaId);
            for(uint j = 0; j<dataRegistryItems.length; j++) {
                // we have all the items with the same id and address marked as topics
                // now we want to see if any of them decode to the supplied log
                if(keccak256(dataRegistryItems[j]) == triggerExpectedHash) {
                    // then use the log data to find the block
                    (uint mode, uint blockNumber, uint observedVersion) = abi.decode(logData, (uint, uint, uint));
                    // decode the data from the supplied event
                    (uint specifiedVersion) = abi.decode(trigger.data, (uint));

                    if(blockNumber <= startBlock &&
                        blockNumber >= endBlock &&
                        observedVersion >= specifiedVersion) {
                    }


                    return true;
                }
            }
        }

        return false;
    }

}


contract TriggerCheckerInterface {
    function occurred(EventInfo trigger, uint startBlock, uint endBlock) public returns (bool);
}

contract ResponseResultCheckerInterface {
    function occurred(EventInfo responseResult, uint eventTriggeredBlock, uint responsePeriod, bytes triggerData) public returns (bool);
}



contract PISAHash2 {
    // NoDeposit = contract set up, but no deposit from PISA.
    // OK = deposit in contract. ready to accept jobs.
    // CHEATED = customer has provided evidence of cheating, and deposit forfeited
    // CLOSED = PISA has shut down serves and withdrawn their coins.
    // TODO: docs dont match the code
    // TODO: in fact the flag isnt used at all! except as a public measure
    enum Flag { OK, CHEATED }

    Flag public flag; // What is current state of PISA?
    uint public cheatedtimer; // How long does PISA have to send customer a refund?

    // List of addresses for PISA
    mapping(address => bool) public watchers;

    // Used to install watchers / modes. Generally its a cold-wallet.
    address payable public admin;

    // Built-in fail safe for the defenderS
    address public defender;

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

    // Keep a record of who was cheated.
    // Ideally, this should be small (or zero!)
    mapping(bytes32 => Cheated) public cheated;
    mapping(address => uint) public refunds;
    uint public pendingrefunds;

    // Did customer try to maliciously hurt PISA? Refund PISA their bond.
    uint public challengeBond;

    // Data registry for looking up the logs
    address public dataregistry;

    event PISARefunded(address watcher, address cus, uint refund, uint timestamp);
    event PISARecordedResponse(bytes32 pisad, address watcher, uint timestamp, uint gas, bytes data);

    // Set up PISA with data registry, timers and the admin address.
    constructor(
        address _dataregistry,
        uint _cheatedtimer,
        uint _challengeBond,
        address payable _admin,
        address _defender
    ) public {
        dataregistry = _dataregistry;
        cheatedtimer = _cheatedtimer;
        challengeBond = _challengeBond;
        admin = _admin;
        defender = _defender;
    }

    struct Appointment {
        AppointmentBase base;

        // trigger
        EventInfo trigger;
        address triggerChecker;

        // some additional info connecting the event with the response
        uint eventResponsePeriod;

        // watcher response information
        ResponseInfo responseInfo;

        // the PISA contract only cheated if a failure state
        // was reached as a result of not fulfilling the appointment
        address failureAddress;
        address failureStateChecker;
    }

    struct AppointmentBase {
        // identifying information
        address payable customer;
        bytes32 id;
        uint nonce;

        // appointment metadata
        uint startBlock;
        uint endBlock;
        uint refund;
        bytes32 paymentHash;
    }

    struct EventInfo {
        address location;
        bytes32 signature;
        bytes32[] topics;
        bytes data;
    }

    struct ResponseInfo {
        address location;
        bytes4 selector;
        bytes data;
        uint gasLimit;
    }

    function isEventTriggered(EventTriggeredAppointment appointment) public pure returns(bool) {
        if(appointment.trigger == 0) return false;
        else return true;
    }

    function respond(
        Appointment memory appointment,
        bytes memory customerSig,
        uint blockObserved
    ) public {
        // TODO: is it necessary to check the watchers here? maybe not, but then we need to check more in the response

        // TODO: why is this important? we could submit for a lower nonce? or the wrong event data?
        require(watchers[msg.sender], "Only a watcher can respond.");

        bytes32 sigHash = keccak256(abi.encode(appointment, address(this)));
        require(appointment.base.customer == recoverEthereumSignedMessage(sigHash, customerSig), "Job not signed by customer.");

        // check the event occurred by looking it up in the data registry
        if(isEventTriggered(appointment)) {
            require(TriggerCheckerInterface(appointment.triggerChecker)
                    .occurred(
                        blockObserved,
                        appointment.trigger,
                        appointment.base.startBlock,
                        appointment.base.endBlock
                    ), "Trigger event did not occur.");
        }

        // TODO: encode this in a library? why do we encode location here?
        // TODO: I've removed the location from this id, why do we need it, the customer should always choose a unique id - their fault if they dont
        bytes32 pisaId = keccak256(abi.encode(appointment.base.customer, appointment.base.id));
        DataRegistryInterface(dataregistry).setRecord(pisaId, abi.encode(block.number, appointment.base.nonce));

        // TODO: first we get the gas - then we call with the gas - have we lost some in the mean time? is this a problem?
        // if we have event data, we need to respond with that dont we?
        require(gasleft() > appointment.responseInfo.gasLimit, "Insufficient gas allocated.");
        appointment.responseInfo.location.call.gas(appointment.responseInfo.gasLimit)(appointment.responseInfo.data);
    }

    struct DataLog {
        uint shard;
        address loggingAddres;
        bytes32 id;
        uint index;
        bytes data;
    }

    function logExists(DataLog log, address loggingAddress, bytes32 logId) public returns(bool) {
        bytes32 h = DataRegistryInterface(dataRegistry).fetchHash(
                            log.shard,
                            loggingAddress,
                            logId,
                            log.index);
        return (h == keccak256(log.data));
    }

    function logMatchesNewHashEvent(DataLog log, EventInfo eventInfo) public returns(bool) {
        require(eventInfo.location == dataRegistry, "Log is not from data registry.");
 
        bytes32 logEventName = trigger.topics[0];
        require(
            keccak256(abi.encode("NewHash(uint, address indexed, bytes32 indexed, uint, bytes, bytes32 indexed)")) == logEventName,
            "Event is not a NewHash event."
        );

        address eventLoggingAddress = address(bytes20(trigger.topics[1]));
        require(eventLoggingAddress == log.loggingAddress, "Event logging address does not match data registry logging address.");

        bytes32 eventLogId = trigger.topics[2];
        require(eventLogId == log.id, "Event log id does not match data registry log id.");

        bytes32 eventDataHash = trigger.topics[3];
        bytes32 dataHash = DataRegistry(dataRegistry).fetchHash(log.shard, log.loggingAddress, log.id, log.index);
        require(eventDataHash == dataHash, "Event data hashs does not match data registry data hash.");
        
        require(keccak256(log.data) == dataHash, "Log data does not match data registry data.")
    }

    // Customer will provide sign receipt + locator to find dispute record in DataRegistry
    // PISA will look up registry to check if PISA has responded to the dispute. If so, it'll verify customer's signature and compare the nonce.
    function recourse(
        Appointment memory appointment,
        bytes memory customerSignature,
        bytes memory watcherSignature,
        bytes memory paymentHashPreImage,
        DataLog memory triggerLog,
        DataLog memory failureLog
    ) public payable isNotFrozen() {
        require(msg.value == challengeBond, "Bad challenge bond");
        require(appointment.paymentHash == keccak256(paymentHashPreImage), "Incorrect payment hash pre image.");
        require(appointment.startBlock + DataRegistryInterface(dataregistry).getInterval() > block.number, "Logs expired.");
        require(block.number > appointment.endBlock, "Appointment has not ended.");

        // TODO: add back in the trigger location address
        bytes32 sigHash = keccak256(abi.encode((appointment), address(this)));
        require(watchers[recoverEthereumSignedMessage(sigHash, watcherSignature)], "Watcher did not sign job.");
        require(appointment.customer == recoverEthereumSignedMessage(sigHash, customerSignature), "Customer did not sign job.");

        if(isEventTriggered(appointment)) {
            // 1. Did the event occur - we use the one in the appointment
            // 2. Some full data for the event has been supplied, does it match the event
            // 3. Dome full data for the failure has been supplied, was it in the dr?
            // 4. Did the full data from the trigger log and the failure log consitute a failure?

            // if this was an event triggered transaction then we need to ensure that
            // the event actually occurred.
            require(TriggerCheckerInterface(appointment.triggerChecker)
                    .occurred(
                        // TODO: block? - no, we should do an exhaustive search again - pass in log data
                        triggerLog,
                        appointment.base.startBlock,
                        appointment.base.endBlock
                    ), "Trigger event did not occur.");
            logMatchesNewHashEvent(triggerLog, appointment.trigger);

            require(logExists(failureLog, appointment.failureAddress, appointment.id), "Failure log does not exist.");

            require(FailureStateChecker(appointment.failureStateChecker)
                    .occurred(
                        triggerData,
                        failureData,
                        appointment.base.startBlock,
                        appointment.eventResponsePeriod
                    ), "Failure state was not reached.");
        }

        // did the watcher try to respond?
        bytes32 pisaId = keccak256(abi.encode(appointment.customer.id, _appointment.base.id));
        bool didRespond = didWatcherRespond(pisaId, appointment.base.nonce, appointment.base.startBlock, appointment.responseTriggerInfo.period);
        require(!didRespond, "The watcher did respond.");

        require(appointment.base.nonce > cheated[pisaId].nonce, "Recourse was already successful");
        // PISA has cheated. Provide opportunity for PISA to respond.
        // Of course... customer may send multiple appointments where PISA failed...
        // We only take into account the log with the largest nonce... and increment
        // pending refund once!
        if(!cheated[pisaId].triggered) pendingrefunds = pendingrefunds + 1;

        cheated[pisaId] = Cheated(appointment.base.nonce, appointment.base.refund + challengeBond, block.number + cheatedtimer, true);
    }


    // Customer will provide sign receipt + locator to find dispute record in DataRegistry
    // PISA will look up registry to check if PISA has responded to the dispute. If so, it'll verify customer's signature and compare the nonce.
    function recourse(Appointment memory _appointment, bytes[] memory _sig, bytes memory _r, bytes[] memory _logdata, uint[] memory _datashard, uint[] memory _dataindex) public payable isNotFrozen() {

        // Customer must put down a bond to issue recourse
        // In case PISA didn't cheat... prevent griefing
        require(msg.value == challengeBond, "Bad challenge bond");

        // Confirm the "mode" in appointment is installed
        // We should reserve a special number "20201225" for "cancelled job"
        require(modeInstalled[_appointment.mode], "Mode is not installed");

        // Verify it is a ratified receipt!
        require(_appointment.h == keccak256(_r), "Wrong R");

        // PISA's log will eventually disappear. So the customer needs to seek recourse
        // within the "disappear" time period. This is set by the DataRegistry.
        // (of course, if we kept logs around forever, this wouldn't be an issue,
        // but then we bloat the network and we are bad citizens to the world,
        // this is ok though since logs should be around for 50,100+ days)
        require(_appointment.startTime + DataRegistryInterface(dataregistry).getInterval() > block.number, "PISA log is likely deleted, so unfair to seek recourse");
        require(block.number > _appointment.finishTime, "PISA still has time to finish the job"); // Give or take, could be end of dispute time, but easier here.

        // Prevent replay attacks
        // Every PISAID is unique to a customer's appointment.
        // Care must be taken, if two customers hire us for the same job, then we need to respond twice (if postcondition fails)
        bytes32 pisaid = keccak256(abi.encode(_appointment.sc, _appointment.cus, _appointment.appointmentid));
        require(_appointment.nonce > cheated[pisaid].nonce, "Recourse was already successful");

        // Both PISA and the customer must have authorised it!
        // This is to avoid PISA faking a receipt and sending it as "recourse"
        // With a "lower" refund amount!
        bytes32 sigHash = keccak256(abi.encode((_appointment), address(this)));
        require(watchers[recoverEthereumSignedMessage(sigHash, _sig[0])], "PISA did not sign job");
        require(_appointment.cus == recoverEthereumSignedMessage(sigHash, _sig[1]), "Customer did not sign job");

        // Was there a post-condition in the contract that should be satisified?
        if(postconditionHandlers[_appointment.mode] != address(0)) {
          // Yes... lets see if PISA was a good tower and the condition is satisified
          // Results "TRUE" is PISA failed to do its job
          require(PostconditionHandlerInterface(postconditionHandlers[_appointment.mode]).hasPISAFailed(dataregistry, _datashard, _appointment.sc, _appointment.appointmentid, _dataindex, _logdata, _appointment.postcondition), "PISA was a good tower");
        }

        // Get the time window to check if PISA responded
        // [start time, finish time, challenge period]
        uint[3] memory timewindow;

        // Is there a challenge period?
        if(challengetimeDecoders[_appointment.mode] != address(0)) {

          // We'll need to "decode" the log and fetch the start/end time from it.
          (timewindow) = ChallengeTimeDecoderInterface(challengetimeDecoders[_appointment.mode]).getTime(dataregistry, _datashard, _appointment.sc, _appointment.appointmentid, _dataindex, _logdata);

          // Time to perform some sanity checks
          require(timewindow[2] >= _appointment.challengeTime, "Contract did not abide by minimum challenge time");  // Finish time - start time >= minimum challenge time
          require(timewindow[1] - timewindow[0] >= _appointment.challengeTime, "Timestamps for start/end of dispute is (somehow) less than challenge time"); // Sanity check (hopefully prevent a bug)
          require(timewindow[0] >= _appointment.startTime, "Dispute started before appointment time...."); // Start time of challenge must be after appointment start time
          require(timewindow[0] < _appointment.finishTime, "Dispute started after appointment time..."); // Challenge must have been triggered BEFORE we stopped watching
          // No check for timewindow[2] > appointment.finishTime.
          // We only care about when it "started" and that the "min challenge time" is reasonable.
        } else {
           timewindow = [_appointment.startTime, _appointment.finishTime, 0];
        }

        // Make sure the values are set to something meaningful
        require(timewindow[0] > 0 && timewindow[1] > 0, "Timing information is not meaningful");

        // Here we check if PISA has responded...
        // Lots of things may have happened (i.e. new appointment is completely different to old one)
        require(!didPISARespond(pisaid, _appointment.nonce, keccak256(abi.encode(_appointment)), timewindow), "PISA sent the right job during the appointment time");

        // PISA has cheated. Provide opportunity for PISA to respond.
        // Of course... customer may send multiple appointments where PISA failed...
        // We only take into account the log with the largest nonce... and increment
        // pending refund once!
        if(!cheated[pisaid].triggered) {
          pendingrefunds = pendingrefunds + 1;
        }

        cheated[pisaid] = Cheated(_appointment.nonce, _appointment.refund + challengeBond, block.number + cheatedtimer, true);
    }

    // Check if PISA recorded a function call for the given appointment/job
    function didWatcherRespond(bytes32 pisaId, uint nonce, uint startBlock, uint responsePeriod) internal returns (bool) {
        for(uint i = 0; i < DataRegistryInterface(dataregistry).getTotalShards(); i++) {
            bytes[] memory dataRegistryItems = DataRegistryInterface(dataregistry).fetchRecords(i, address(this), pisaId);

            // It'll return a list of jobs for this given appointment (i.e. if PISA had to respond more than once)
            for(uint j = 0; j<dataRegistryItems.length; j++) {
                (uint blockNumber, uint nonce) = abi.decode(dataRegistryItems[j], (uint, uint));

                // we cant check the start and end block here because if the nonce is not equal to the current one
                // the start and end block may be different
                if(nonce > appointment.nonce) return true;
                else if(
                    nonce = appointment.nonce &&
                    blockNumber >= startBlock &&
                    blockNumber <= startBlock + responsePeriod
                    ) {
                    return true;
                }
            }

        }
        // Couldn't find a watcher response
        return false;
    }

    // to cancel an appointment we can just assign an appointment to an address that we know can never emit an address
    function cancelledAppointment(RelayAppointment memory appointment, bytes memory customerSig) public {
        // Check signature
        bytes32 sighash = keccak256(abi.encode(appointment, address(this)));
        require(appointment.customer == recoverEthereumSignedMessage(sighash, customerSig), "Customer did not sign job.");

        bytes32 appointmentId = keccak256(abi.encode(appointment.customer, appointment.id));

        // Is the nonce here larger than the cheat log?
        require(appointment.base.nonce > cheated[appointmentId].nonce, "Supplied nonce is not greater than the cheated nonce.");

        // OK we can remove cheat log and give PISA the bond
        refunds[admin] = refunds[admin] + challengeBond;

        // Update cheat log + pending refunds accordingly
        cheated[appointmentId].nonce = appointment.base.nonce;
        cheated[appointmentId].triggered = false; // No longer triggered!
        cheated[appointmentId].refund = 0;
        cheated[appointmentId].refundby = 0;
        pendingrefunds = pendingrefunds - 1;
    }

    // To cancel an appointment, just need to sign a larger nonce with mode=496 (perfect number)
    // Customer may send older (and cancelled) appointment via recourse... PISA can just respond
    // with the cancelled receipt and claim the bond :)
    function cancelledAppointment(Appointment memory _appointment, bytes memory _cussig) public {
      // TODO: It doesn't look like we need this check (anything bad can happen if customer sets nonce too large?
      // I don't think so.... will just cancel their own refund lol
      // require(watchers[msg.sender] || admin == msg.sender, "Only PISA can call it");

      // Check signature
      bytes32 sighash = keccak256(abi.encode(_appointment, address(this)));
      require(_appointment.cus == recoverEthereumSignedMessage(sighash, _cussig), "Customer did not sign job");

      // Compute PISAID
      bytes32 pisaid = keccak256(abi.encode(_appointment.sc, _appointment.cus, _appointment.appointmentid));

      // Is the nonce here larger than the cheat log?
      require(_appointment.nonce > cheated[pisaid].nonce, "PISA submitted an older appointment");

      // OK we can remove cheat log and give PISA the bond
      refunds[admin] = refunds[admin] + challengeBond;

      // Update cheat log + pending refunds accordingly
      cheated[pisaid].nonce = _appointment.nonce;
      cheated[pisaid].triggered = false; // No longer triggered!
      cheated[pisaid].refund = 0;
      cheated[pisaid].refundby = 0;
      pendingrefunds = pendingrefunds - 1;

    }

    // PISA must refund the customer before a deadline. If not, the security deposit is burnt/frozen
    function refundCustomer(address _sc, address _cus, uint _appointmentid) payable public {
        // Should be some refunds ready...
        require(pendingrefunds > 0, "No refunds pending");
        bytes32 pisaid = keccak256(abi.encode(_sc, _cus, _appointmentid));

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
    function withdraw(
        address payable _receiver,
        uint _amount,
        uint _blockstamp,
        address _customer,
        bytes memory _customerig
    ) public payable {
        require(_amount == refunds[_customer], "Custmomer has not been assigned refund balance.");
        require(_blockstamp > block.number - 100 && block.number + 100 > _blockstamp, "Incorrect withdrawal window."); // blockno - 100 -> timestamp <- blockno + 100 (200 block window)

        bytes32 h = keccak256(abi.encode(_receiver, _amount, _blockstamp, address(this)));
        require(recoverEthereumSignedMessage(h, _customerSig) == _customer, "Customer did not authorise this withdrawal.");

        // Perform the transfer
        uint bal = refunds[_customer];
        refunds[_customer] = 0;
        _receiver.transfer(bal);
    }

    // PISA hasn't refunded the customer by the desired time?
    // .... time to issue the ultimate punishment
    function forfeit(bytes32 _pisaid) public isNotFrozen {

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
    function failSafe() public {
        require(msg.sender == defender, "Only defender can trigger the fail-safe");

        // Lock down contract and re-set flag
        frozen = true;
        flag = Flag.OK;
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
