pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract LogRegistryInterface {

    function setData(uint _logid, bytes memory _data) public returns(uint _datashard, uint _index);
}

contract ChallengeCommandContract {

    enum Flag {RESOLVED, CHALLENGE}
    Flag flag = Flag.RESOLVED;
    
    uint challengePeriod;
    uint challengeExpiry;

    uint v; 
    
    address LogRegistry;
    uint logid; 

    event ChallengeEvent(uint shard, address addr, uint id, uint index, bytes data);
    event ResolveEvent(uint shard, address addr, uint id, uint index, bytes data);

    constructor(address _registry) public {
        LogRegistry = _registry;
        challengePeriod = 50; 
    }

    // Initiate an on-chain challenge
    function trigger() public {
        require(flag == Flag.RESOLVED);
        flag = Flag.CHALLENGE;
        challengeExpiry = block.number + challengePeriod;

        // Log Format: MSG TYPE, TIMESTAMP, CHALLENGE PERIOD, Starting Counter
        // MsgType = 0 (Trigger Message)
        bytes memory encoded = abi.encode(0, block.number, challengePeriod, v);
        uint datashard;
        uint index;
        
        (datashard, index) = LogRegistryInterface(LogRegistry).setData(logid, encoded);

        emit ChallengeEvent(datashard, address(this), logid, index, encoded);
    }
    
    function evidence(bytes memory action) public {
        require(flag == Flag.CHALLENGE);

        // Counterfactual just extends deadline, v does not increment. 
        challengeExpiry = challengeExpiry + challengePeriod;
    }

    // PISA will send the agreed "latest state"
    function refute(uint _v) public {
      require(_v > v);
      v = _v;
      
      // Cancel challenge period 
      flag = Flag.RESOLVED;
      challengeExpiry = 0;
    }

    function resolve() public {
        require(flag == Flag.CHALLENGE);
        require(block.number > challengeExpiry);

        flag = Flag.RESOLVED;
        v = v + 1; // Just increments by 1...

        // Log Format: MSGTYPE, TIMESTAMP, V
        // 1 = resolve, block number, counter from evidence.
        bytes memory encoded = abi.encode(1, block.number, v);
        uint datashard;
        uint index;
        (datashard, index) = LogRegistryInterface(LogRegistry).setData(logid, encoded);

        emit ResolveEvent(datashard, address(this), logid, index, encoded);
    }

    function getV() public view returns (uint) {
      return v;
    }

    function getFlag() public view returns (uint) {
      return uint(flag);
    }
}
