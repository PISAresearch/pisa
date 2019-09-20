pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract EventStorage {
    struct Event {
        uint blockNumber;
        bytes32[4] topics;
        // TODO: do we need to store this, or just the hash of it for verification?
        // TODO: full store for now - can change it later
        bytes32 dataHash;
    }

    mapping(bytes32 => Event) public lookup;

    mapping(bytes32 => bytes32[]) public topicsToKeys;

    function putEvent(bytes32[4] memory topics, bytes memory data) public {
        bytes32 key = keccak256(abi.encodePacked(msg.sender, topics, data));
        lookup[key] = Event({ blockNumber: block.number, topics: topics, dataHash: keccak256(data) });
    }

    function putEvent2(bytes32[4] memory topics, bytes memory data) public {
        bytes32 key = keccak256(abi.encodePacked(msg.sender, block.number, topics, data));

        // topics[0] cannot be empty, neither can msg.sender
        topicsToKeys[keccak256(abi.encodePacked(msg.sender, topics[0]))].push(key);

        // what about empty topics
        if(topics[1] != 0) topicsToKeys[topics[1]].push(key);
        if(topics[2] != 0) topicsToKeys[topics[2]].push(key);
        if(topics[3] != 0) topicsToKeys[topics[3]].push(key);
        
        lookup[key] = Event({ blockNumber: block.number, topics: topics, dataHash: keccak256(data) });
    }

    function getMatchingEvents(address emitter, bytes32[4] memory topics) public {
        // there should always be the first key
        bytes32 key0 = keccak256(abi.encodePacked(emitter, topics[0]));
        if(topicsToKeys)



    }
}