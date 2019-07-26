pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract DataRegistryInterface {

    // Log all challenges (and resolving it) via the data registry
    function setHash(uint _channelid, bytes memory _data) public returns(uint _datashard, uint _index);
}

contract MultiChannelContract {

    // We only care about challenges
    enum Flag {RESOLVED, CHALLENGE}

    // ID to a channnel
    mapping (uint => Channel) channels;

    struct Channel {
      address user1; address user2;
      uint bal1; uint bal2;
      uint v; Flag flag;
      uint challengeExpiry; bool open;
    }

    // Challenge time information
    uint challengePeriod;

    // Data Registry logging information
    address dataregistry;

    event ChallengeEvent(uint shard, address addr, uint id, uint index, bytes data);
    event RefuteEvent(address addr, uint channelid, uint v);
    event ResolveEvent(uint shard, address addr, uint id, uint index, bytes data);

    // Install data registry upon startup.
    constructor(address _registry) public {
        dataregistry = _registry;
        challengePeriod = 50; // hard-coded
    }

    /* *******************************
     * All channels have a unique identifier ID that is computed in a deterministic manner.
     * Why? H(user1, user2, address(this)) lets PISA verify who is in the channel and whether
     * the signed state update will work if there is an on-chain dispute.
     * If we let the user pick a random ID, then PISA cannot verify signatures from user1/user2
     * will work to resolve a dispute for a given ID....
     * ... unless id -> user1,user2 is explicitly stored in the blockchain, which may not be desirable.
     * **********/
    function fundChannel(address _user1, address _user2) public payable {
        require(msg.sender == _user1 || msg.sender == _user2);

        bytes32 h = keccak256(abi.encode(_user1, _user2, address(this)));
        uint id = uint(h);

        // Is the channel already open?
        if(channels[id].open) {

            bool check;

            // Channel must be set up as...
            // user1 == msg.sender and user2 == _user2
            // OR
            // user1 == _user2 and user1 == msg.sender
            if(channels[id].user1 == msg.sender && channels[id].user2 == _user2) {
                channels[id].bal1 = channels[id].bal1 + msg.value;
                check = true;

            } else if(channels[id].user1 == _user2 || channels[id].user2 == msg.sender) {
                channels[id].bal2 = channels[id].bal2 + msg.value;
                check = true;
            }

            // Make sure some money was funded...
            // Otherwise throw and save their coins
            require(check);
            return;

        }
        // OK so the ID wasn't opened previously... lets open it
        Channel memory chan = Channel(msg.sender, _user2 , msg.value, 0, 0, Flag.RESOLVED, 0, true);
        channels[id] = chan;
    }

    // Initiate an on-chain challenge
    function trigger(uint _id) public {
        require(channels[_id].flag == Flag.RESOLVED);
        channels[_id].flag = Flag.CHALLENGE;
        channels[_id].challengeExpiry = block.number + challengePeriod;

        // Format: MSG TYPE, TIMESTAMP, CHALLENGE PERIOD, Starting Counter
        // MsgType = 0 (Trigger Message)
        bytes memory encoded = abi.encode(0, block.number, challengePeriod, channels[_id].v);
        uint datashard;
        uint index;
        (datashard, index) = DataRegistryInterface(dataregistry).setHash(_id, encoded);

        emit ChallengeEvent(datashard, address(this), _id, index, encoded);
    }

    // Evidence for the challenge period
    function evidence(uint _id) public {
        require(channels[_id].flag == Flag.CHALLENGE);

        // Ideally some "action" or "evidence" is sent here
        // And potentially processed via the blockchain.
        // We ignore it... because it doesn't matter for us.

        channels[_id].challengeExpiry = channels[_id].challengeExpiry + challengePeriod;
    }

    // PISA will send the agreed "latest state"
    // This should cancel the dispute process...
    function refute(uint _id, uint _v) public {
      require(_v > channels[_id].v);

      channels[_id].v = _v;
      channels[_id].flag = Flag.RESOLVED;
      channels[_id].challengeExpiry = 0;
      emit RefuteEvent(msg.sender, _id, _v);
    }

    // Resolve an on-chain challenge
    function resolve(uint _id) public {
        require(channels[_id].flag == Flag.CHALLENGE);
        require(block.number > channels[_id].challengeExpiry);

        // Store log and resolve challenge
        channels[_id].flag = Flag.RESOLVED;
        channels[_id].v = channels[_id].v + 1; // Just increments by 1... all commands executed in real-time

        // MSGTYPE, TIMESTAMP, V
        // 1 = resolve, block number, counter from evidence.
        bytes memory encoded = abi.encode(1, block.number, channels[_id].v);
        uint datashard;
        uint index;
        (datashard, index) = DataRegistryInterface(dataregistry).setHash(_id, encoded);

        emit ResolveEvent(datashard, address(this), _id, index, encoded);
    }

    // Helper function for unit-testing
    function getV(uint _id) public view returns (uint) {
      return channels[_id].v;
    }

    function getFlag(uint _id) public view returns (uint) {
      return uint(channels[_id].flag);
    }

    function isOpen(uint _id) public view returns (bool) {
      return channels[_id].open;
    }

    function getChannelID(address _user1, address _user2) public view returns(uint) {
      bytes32 h = keccak256(abi.encode(_user1, _user2, address(this)));
      return uint(h);
    }
}
