pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract DataRegistryInterface {

    // Log all challenges (and resolving it) via the data registry
    function setData(uint _appointmentid, bytes memory _data) public returns(uint _datashard, uint _index);
}

contract ChallengeClosureContract {

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
        id = 0; // Unique log identifier
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
        (datashard, index) = DataRegistryInterface(dataregistry).setData(uint(id), encoded);

        emit ChallengeEvent(datashard, address(this), uint(id), index, encoded);
    }

    // Evidence for the challenge period
    // PISA is expected to call it.
    function evidence(uint _v) public {
        require(flag == Flag.CHALLENGE);
        require(_v > v);
        v = _v;
    }

    // Perhaps the on-chain challenge gets cancelled altogether
    function cancel() public {
        require(flag == Flag.CHALLENGE);
        flag = Flag.RESOLVED;
    }

    // Resolve an on-chain challenge
    function resolve() public {
        require(flag == Flag.CHALLENGE);
        require(block.number > challengeExpiry);

        // Store log and resolve challenge
        flag = Flag.RESOLVED;

        // MSGTYPE, TIMESTAMP, V
        // 1 = resolve, block number, counter from evidence.
        bytes memory encoded = abi.encode(1, block.number, v);
        uint datashard;
        uint index;
        (datashard, index) = DataRegistryInterface(dataregistry).setData(uint(id), encoded);

        emit ResolveEvent(datashard, address(this), uint(id), index, encoded);
    }

    // Helper function for unit-testing
    function getV() public view returns (uint) {
      return v;
    }
}
