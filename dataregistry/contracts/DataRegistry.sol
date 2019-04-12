pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

// There are two contracts:
// - DailyRecord maintains data sent on a given day
// - DataRegistry maintains a list of DailyRecords, and ensures delete/create each DailyRecord after TOTAL_DAYS
contract DailyRecord {

   uint public creationTime; // What unix timestamp was this record created?

   address payable owner; // DataRegistry Contract

   // The DisputeRegistry should be the owner!
   modifier onlyOwner {
       require(msg.sender == owner);
       _;
   }

   // State Channel Address => List of Records for Today
   mapping (address => bytes[]) records;

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

   // starttime, endtime, ctr should be from the customer's receipt.
   function fetchData(address _sc) public view returns (bytes[] memory) {
       return records[_sc];
   }

   // Store a dispute
   function setData(address _sc, bytes memory data) onlyOwner public {

       // Nice thing: Constant look-up to find the caller's records (based on the day).
       bytes[] storage sc_records = records[_sc];
       sc_records.push(data);
   }
}

// The data registry is responsible maintaining a list of DailyRecords.
// Two functions:
// - setData stores the data (and associated address) in a DailyRecord.
// - fetchRecords stores
// - TestDispute is called by PISA, it'll look up all disputes on a given day for a state channel. And then confirm if PISA cheated.
contract DataRegistry {

   // Used to signal to the world about a new dispute record
   // "Day" is used to lookup the dispute record later on!
   event NewRecord(address sc, bytes data);
   event KillDailyRecord(address addr, uint createtime, uint day);
   event CreateDailyRecord(address addr, uint createtime, uint day);

   // Day of the week => Address for DailyRecord
   mapping (uint => address) dailyrecord;

   // Time helper function
   uint constant DAY_IN_SECONDS = 86400;
   uint constant TOTAL_DAYS = 14;

   function getTotalDays() public pure returns (uint) {
     return TOTAL_DAYS;
   }

   function getDataShard(uint _timestamp) public pure returns (uint8) {

        // Timestamp/days in seconds. +4 is used to push it to sunday as starting day.
        // "14" lets us keep records around for 14 days!
       return uint8(((_timestamp / DAY_IN_SECONDS) + 4) % TOTAL_DAYS);
   }

   function getDailyRecordAddress(uint _timestamp) public view returns (address) {

     return dailyrecord[getDataShard(_timestamp)];
   }

   // Fetch a list of data records for a smart contract from a given datashard.
   function fetchRecords(address _sc, uint _datashard) public returns (bytes[] memory) {
       DailyRecord rc = resetRecord(_datashard);

       return rc.fetchData(_sc);
   }

   // Checks whether the contract that keeps track of records is "fresh" for today.
   // We track every by day of week (so if it was created this day last week; we delete and re-create it)
   function resetRecord(uint _datashard) internal returns (DailyRecord) {

        DailyRecord rc;

       // Does it exist?
       if(address(0) != dailyrecord[_datashard]) {
            rc = DailyRecord(dailyrecord[_datashard]);

            // Is it older than today?
            if(now - rc.getCreationTime() > DAY_IN_SECONDS) {
                emit KillDailyRecord(dailyrecord[_datashard], now, _datashard);
                rc.kill();
            } else {
                // Not older than today... just return... all good!
                return rc;
            }
       }

      // Looks like it didn't exist!
      rc = new DailyRecord(now);
      dailyrecord[_datashard] = address(rc);
      require(rc.getCreationTime() == now);

      // Tell world that we create this record
      emit CreateDailyRecord(dailyrecord[_datashard], now, _datashard);

      return rc;
   }

   // Record data from the sender and store it in the DailyRecord
   function setData(bytes memory data) public {

      // TimeInformation info = TimeInformation(timeinfo);
      uint datashard = (getDataShard(now));

      // Fetch the DailyRecord for this day. (It may reset it under the hood)
      DailyRecord rc = resetRecord(datashard);

      // Update record!
      rc.setData(msg.sender, data);

      // If it worked... tell the world we added the record!
      emit NewRecord(msg.sender, data);
   }

}
