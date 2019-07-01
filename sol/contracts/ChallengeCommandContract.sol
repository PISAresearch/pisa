pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract DataRegistryInterface {

    // Log all challenges (and resolving it) via the data registry
    function setRecord(uint _appointmentid, bytes memory _data) public returns(uint _datashard, uint _index);
}

contract ChallengeCommandContract {

    // We only care about challenges
    enum Flag {RESOLVED, CHALLENGE}
    Flag flag = Flag.RESOLVED;

    // Challenge time information
    uint challengePeriod;
    uint challengeExpiry;

    // Challenge period focuses on deciding the final "version"
    uint v; // The "post-condition" we care about... version.

    // Data Registry logging information
    address dataregistry;
    uint id;

    event ChallengeEvent(uint shard, address addr, uint id, uint index, bytes data);
    event ResolveEvent(uint shard, address addr, uint id, uint index, bytes data);

    // Install data registry upon startup.
    constructor(address _registry) public {
        dataregistry = _registry;
        id = 0; // We are just using the default
        challengePeriod = 50; // hard-coded, 50 blocks.
    }

    // Initiate an on-chain challenge
    function trigger() public {
        require(flag == Flag.RESOLVED);
        flag = Flag.CHALLENGE;
        challengeExpiry = block.number + challengePeriod;

        // Format: MSG TYPE, TIMESTAMP, CHALLENGE PERIOD, Starting Counter
        // MsgType = 0 (Trigger Message)
        bytes memory encoded = abi.encode(0, block.number, challengePeriod, v);
        uint datashard;
        uint index;
        (datashard, index) = DataRegistryInterface(dataregistry).setRecord(uint(id), encoded);
        emit ChallengeEvent(datashard, address(this), uint(id), index, encoded);
    }

    // Evidence for the challenge period
    // PISA is expected to call it.
    function evidence() public {
        require(flag == Flag.CHALLENGE);

        // Ideally some "action" or "evidence" is sent here
        // And potentially processed via the blockchain.
        // We ignore it... because it doesn't matter for us.
        
        challengeExpiry = challengeExpiry + challengePeriod;
    }

    // PISA will send the agreed "latest state"
    // This should cancel the dispute process...
    function refute(uint _v) public {
      require(_v > v);

      v = _v;
      flag = Flag.RESOLVED;
      challengeExpiry = 0;
    }

    // Resolve an on-chain challenge
    function resolve() public {
        require(flag == Flag.CHALLENGE);
        require(block.number > challengeExpiry);

        // Store log and resolve challenge
        flag = Flag.RESOLVED;
        v = v + 1; // Just increments by 1... all commands executed in real-time

        // MSGTYPE, TIMESTAMP, V
        // 1 = resolve, block number, counter from evidence.
        bytes memory encoded = abi.encode(1, block.number, v);
        uint datashard;
        uint index;
        (datashard, index) = DataRegistryInterface(dataregistry).setRecord(uint(id), encoded);
        emit ResolveEvent(datashard, address(this), id, index, encoded);
    }

    // Helper function for unit-testing
    function getV() public view returns (uint) {
      return v;
    }

    function getFlag() public view returns (uint) {
      return uint(flag);
    }
}
