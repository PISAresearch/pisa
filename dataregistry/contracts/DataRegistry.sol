pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

// There are two contracts:
// - DataShard maintains data sent on a given day
// - LogRegistry maintains a list of DataShards, and ensures delete/create each DataShard after TOTAL_SHARDS
contract DataShard {

   uint public creationTime; // What unix timestamp was this record created?

   address payable owner; // LogRegistry Contract

   // The DisputeRegistry should be the owner!
   modifier onlyOwner {
       require(msg.sender == owner);
       _;
   }

   // Smart Contract Address => ID-based data storage
   mapping (address => mapping (uint => bytes[])) records;

   // Creation time for this daily record.
   constructor(uint t) public {
       creationTime = t;
       owner = msg.sender;
   }

   // Destory this contruct (and all its entries)
   function kill() public onlyOwner {
       selfdestruct(owner);
   }

   // Get creation time
   function getCreationTime() public view returns (uint) {
       return creationTime;
   }

   // Given a smart contract address and the ID, fetch the recorded bytes.
   // Return "bool" to avoid an out of bound exception
   function fetchItem(address _sc, uint _id, uint _index) public view returns (bytes memory) {
       if(_index < records[_sc][_id].length) {
           return (records[_sc][_id][_index]);
       }
   }

   // Given a smart contract address and the ID, fetch the recorded bytes.
   function fetchList(address _sc, uint _id) public view returns (bytes[] memory) {
       return records[_sc][_id];

   }

   // Given a smart contract address, the ID and the bytes, store the data.
   function setData(address _sc, uint _id, bytes memory _data) onlyOwner public returns(uint) {
       // Cannot re-write over an existing data field
       records[_sc][_id].push(_data);

       return records[_sc][_id].length-1;
   }
}

// The data registry is responsible maintaining a list of DataShards.
// Two functions:
// - setData stores the data according to a unique ID and the sender's address.
// - fetchRecords lets us retrieve stored data from a datashard based on a unique ID and the sender's address
contract LogRegistry {

   // Used to signal to the world about a new dispute record
   event NewRecord(uint datashard, address sc, uint id, uint index, bytes data);
   event KillDataShard(address addr, uint time, uint datashard);
   event CreateDataShard(address addr, uint time, uint datashard);

   // Shard ID => Address for DataShard
   mapping (uint => address) datashards;

   // Time helper function
   uint constant INTERVAL = 86400*50;
   uint constant TOTAL_SHARDS = 2;

   function getInterval() public pure returns (uint) {
      return INTERVAL;
   }
   function getTotalShards() public pure returns (uint) {
      return TOTAL_SHARDS;
   }

   constructor() public {
     // Create data shards from today onwards.
     uint timestamp = now;

     // Create the data shards (and set timestamps in future)
     for(uint i=0; i<TOTAL_SHARDS; i++) {
        uint datashard = getDataShardIndex(timestamp);
        createDataShard(timestamp, datashard);
        timestamp = timestamp + INTERVAL;
     }

   }

   // Create data shards for a given tmestamp
   function createDataShard(uint _timestamp, uint _datashard) internal {
      DataShard rc = new DataShard(_timestamp);
      datashards[_datashard] = address(rc);

      // Tell world that we create this record
      emit CreateDataShard(datashards[_datashard], _timestamp, _datashard);
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
   function fetchRecord(uint _datashard, address _sc, uint _id, uint _index) public returns (bytes memory) {

       // Confirm the data shard exists so we can fetch data
      if(datashards[_datashard] != address(0)) {
          DataShard rc = resetRecord(_datashard);
          return rc.fetchItem(_sc, _id, _index);
      }
   }

   // Fetch a list of data records for a smart contract at a given datashard.
   function fetchRecords(uint _datashard, address _sc, uint _id) public returns (bytes[] memory) {

       // Confirm the data shard exists so we can fetch data
      if(datashards[_datashard] != address(0)) {
          DataShard rc = resetRecord(_datashard);
          return rc.fetchList(_sc, _id);
      }
   }

   // Checks whether the contract that keeps track of records is "fresh" for today.
   // We track every by day of week (so if it was created this day last week; we delete and re-create it)
   function resetRecord(uint _datashard) internal returns (DataShard) {

      // Is it older than today?
      if(now - DataShard(datashards[_datashard]).getCreationTime() > INTERVAL) {
          emit KillDataShard(datashards[_datashard], now, _datashard);
          DataShard(datashards[_datashard]).kill();
          createDataShard(now, _datashard);
          return DataShard(datashards[_datashard]);
      } else {
          // Not older than today... just return... all good!
          return DataShard(datashards[_datashard]);
      }
   }

   // Record data from the sender and store it in the DataShard
   function setData(uint _id, bytes memory _data) public returns (uint, uint) {

      // Fetch Index
      uint datashard = (getDataShardIndex(now));

      // Fetch the DataShard for this day. (It may reset it under the hood)
      DataShard rc = resetRecord(datashard);

      // Update record!
      uint index;
      index = rc.setData(msg.sender, _id, _data);

      // Tell the world we added the record!
      emit NewRecord(datashard, msg.sender, _id, index, _data);

      return (datashard, index);
   }
}
