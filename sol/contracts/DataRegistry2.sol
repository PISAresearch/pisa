pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

// There are two contracts:
// - DataShard maintains data sent on a given day
// - DataRegistry maintains a list of DataShards, and ensures delete/create each DataShard after a long INTERVAL.
contract DataShard {

   uint public creationBlock; // What block number was this record created?

   address payable owner; // DataRegistry Contract

   // The DisputeRegistry should be the owner!
   modifier onlyOwner {
       require(msg.sender == owner);
       _;
   }
   
   // Smart Contract Address => ID-based data storage
   mapping (address => mapping (bytes32 => bytes[])) records;
   mapping (address => mapping (bytes32 => bytes32[])) hashes;

   // Creation time for this daily record.
   constructor(uint blockNo) public {
       creationBlock = blockNo;
       owner = msg.sender;
   }

   // Destory this contruct (and all its entries)
   function kill() public onlyOwner {
       selfdestruct(owner);
   }

   // Get creation time
   function getCreationBlock() public view returns (uint) {
       return creationBlock;
   }

   // The following will store BYTES in the DataShard (i.e. timestamp data)

   // Given a smart contract address and the ID, fetch the recorded bytes.
   // Return "bool" to avoid an out of bound exception
   function fetchRecord(address _sc, bytes32 _id, uint _index) public view returns (bytes memory) {
       if(_index < records[_sc][_id].length) {
           return (records[_sc][_id][_index]);
       }
   }

   // Given a smart contract address and the ID, fetch the recorded bytes.
   function fetchRecords(address _sc, bytes32 _id) public view returns (bytes[] memory) {
       return records[_sc][_id];

   }

   // Given a smart contract address, the ID and the bytes, store the data.
   function setRecord(address _sc, bytes32 _id, bytes memory _data) onlyOwner public returns(uint) {
       // Cannot re-write over an existing data field
       records[_sc][_id].push(_data);

       return records[_sc][_id].length-1;
   }

   // The following will store HASHES in the DataShard (i.e. timestamp commitments)

   // Given a smart contract address and the ID, fetch the recorded bytes.
   function fetchHash(address _sc, bytes32 _id, uint _index) public view returns (bytes32) {
       if(_index < hashes[_sc][_id].length) {
          return hashes[_sc][_id][_index];
       }
   }

   // Given a smart contract address and the ID, fetch the recorded bytes.
   function fetchHashes(address _sc, bytes32 _id) public view returns (bytes32[] memory) {
       return hashes[_sc][_id];
   }

   // Given a smart contract address, the ID and the bytes, store the data.
   function setHash(address _sc, bytes32 _id, bytes32 _hash) onlyOwner public returns(uint) {
       // Cannot re-write over an existing data field
       hashes[_sc][_id].push(_hash);

       return hashes[_sc][_id].length-1;
   }

}

// The data registry is responsible maintaining a list of DataShards.
// Two functions:
// - setData stores the data according to a unique ID and the sender's address.
// - fetchRecords lets us retrieve stored data from a datashard based on a unique ID and the sender's address
contract DataRegistry {

   // Used to signal to the world about a new dispute record
   event NewRecord(uint datashard, address sc, bytes32 id, uint index, bytes data);
   event NewHash(uint datashard, address indexed sc, bytes32 indexed id, uint index, bytes data, bytes32 h, uint blockNumber);
   event KillDataShard(address addr, uint time, uint datashard);
   event CreateDataShard(address addr, uint time, uint datashard);

   // Shard ID => Address for DataShard
   mapping (uint => address) datashards;

   // Time helper function
   uint constant INTERVAL = 100*5; // Approximately 6000 blocks a day
   uint constant TOTAL_SHARDS = 2;

   function getInterval() public pure returns (uint) {
      return INTERVAL;
   }
   function getTotalShards() public pure returns (uint) {
      return TOTAL_SHARDS;
   }

   constructor() public {
     // Create data shards from today onwards.
     uint blockno = block.number;

     // Create the data shards (and set timestamps in future)
     for(uint i=0; i<TOTAL_SHARDS; i++) {
        uint datashard = getDataShardIndex(blockno);
        createDataShard(blockno, datashard);
        blockno = blockno + INTERVAL;
     }

   }

   // Create data shards for a given tmestamp
   function createDataShard(uint _timestamp, uint _datashard) internal {
      DataShard rc = new DataShard(_timestamp);
      datashards[_datashard] = address(rc);

      // Tell world that we create this record
      emit CreateDataShard(datashards[_datashard], _timestamp, _datashard);
   }

   // Checks whether the contract that keeps track of records is "fresh" for today.
   // We may need to re-set it by deleting/recreating data shard.
   function resetDataShard(uint _datashard) internal returns (DataShard) {

      // We need to do full loop before deleting an old shard!
      if(block.number - DataShard(datashards[_datashard]).getCreationBlock() >= INTERVAL*2) {
          emit KillDataShard(datashards[_datashard], block.number, _datashard);
          DataShard(datashards[_datashard]).kill();
          createDataShard(block.number, _datashard);
          return DataShard(datashards[_datashard]);
      } else {
          // Not older than today... just return... all good!
          return DataShard(datashards[_datashard]);
      }
   }

   // Compute the "day" for a data shard given a timestamp
   function getDataShardIndex(uint _timestamp) public pure returns (uint8) {

      // Fetch data shard based on timestamp
      return uint8((_timestamp/INTERVAL) % TOTAL_SHARDS);
   }

   // Fetch contract address for data shard at a given timestamp
   // Caution: We don't check the freshness of timestamps.
   // Old / future timestamps will resolve to a day.
   function getDataShardAddress(uint _timestamp) public view returns (address) {
      return datashards[getDataShardIndex(_timestamp)];
   }

   // Fetch a list of data records for a smart contract at a given datashard.
   function fetchRecord(uint _datashard, address _sc, bytes32 _id, uint _index) public returns (bytes memory) {

       // Confirm the data shard exists so we can fetch data
      if(datashards[_datashard] != address(0)) {
          DataShard rc = resetDataShard(_datashard);
          return rc.fetchRecord(_sc, _id, _index);
      }
   }

   // Fetch a list of data records for a smart contract at a given datashard.
   function fetchRecords(uint _datashard, address _sc, bytes32 _id) public returns (bytes[] memory) {

       // Confirm the data shard exists so we can fetch data
      if(datashards[_datashard] != address(0)) {
          DataShard rc = resetDataShard(_datashard);
          return rc.fetchRecords(_sc, _id);
      }
   }

   // Record data from the sender and store it in the DataShard
   function setRecord(bytes32 _id, bytes memory _data) public returns (uint, uint) {

      // Fetch Index
      uint datashard = (getDataShardIndex(block.number));

      // Fetch the DataShard for this day. (It may reset it under the hood)
      DataShard rc = resetDataShard(datashard);

      // Update record!
      uint index;
      index = rc.setRecord(msg.sender, _id, _data);

      // Tell the world we added the record!
      emit NewRecord(datashard, msg.sender, _id, index, _data);

      return (datashard, index);
   }


  // Fetch a list of data records for a smart contract at a given datashard.
  function fetchHash(uint _datashard, address _sc, bytes32 _id, uint _index) public returns (bytes32) {

       // Confirm the data shard exists so we can fetch data
      if(datashards[_datashard] != address(0)) {
          DataShard rc = resetDataShard(_datashard);
          return rc.fetchHash(_sc, _id, _index);
      }
   }

   // Fetch a list of data records for a smart contract at a given datashard.
   function fetchHashes(uint _datashard, address _sc, bytes32 _id) public returns (bytes32[] memory) {

        // Confirm the data shard exists so we can fetch data
       if(datashards[_datashard] != address(0)) {
           DataShard rc = resetDataShard(_datashard);
           return rc.fetchHashes(_sc, _id);
       }
    }

   // Record data from the sender and store it in the DataShard
   function setHash(bytes32 _id, bytes memory _data) public returns (uint, uint) {

      // Fetch Index
      uint datashard = (getDataShardIndex(block.number));

      // Fetch the DataShard for this day. (It may reset it under the hood)
      DataShard rc = resetDataShard(datashard);

      // Update record!
      uint index;
      bytes32 h = keccak256(_data);
      index = rc.setHash(msg.sender, _id, h);

      // Tell the world we added the record!
      emit NewHash(datashard, msg.sender, _id, index, _data, h);

      return (datashard, index);
   }
}
