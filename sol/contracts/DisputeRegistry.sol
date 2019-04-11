pragma solidity ^0.5.0;

// I borrowed date code from https://github.com/pipermerriam/ethereum-datetime/blob/master/contracts/DateTime.sol

// There are two contracts:
// - DailyRecord maintains dispute records for a given day.
// - DisputeRegistry maintains a list of DailyRecords, and ensures delete/create each DailyRecord after a week.
// Dispute Manager records all dispute from state channels. Callers can only modify their own records!
// All records are disputed after 1 week
// i.e. if we call on same day next week; the new automatically delete all records for that day last week!
// We rely on the block timestamp (which strictly increases) to work out what day we are on.

// DailyRecord contract stores all dispute records for a given day.
// It allows us to test whether a dispute will be successful.
// It is FULLY CONTROLLED by the DisputeRegistry contract!
// The owner contract is defined below - effectively controls a list of daily records.
contract DailyRecord {

   uint public creationTime;

   // Master Registry Contract
   address payable owner;

   // The DisputeRegistry should be the owner!
   modifier onlyOwner {
       require(msg.sender == owner);
       _;
   }

    // Dispute Record Format.
   struct Record {
       uint start;
       uint end;
       uint version;
   }

   // State Channel Address => List of Records for Today
   mapping (address => Record[]) records;

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
   function testReceipt(uint _channelmode, address _sc, uint _starttime, uint _expiry, uint _version) public view returns (bool) {

       // Nice thing: Constant look-up to find the caller's records (based on the day).
       Record[] storage sc_record = records[_sc];

       // Right now, we must iterate over all disputes for a given day and channel.
       // Should be OK - only channel disputer can disrupt it and time delay should prevent it
       // from being huge (i.e. 2 hours per dispute).
       for(uint i=0; i<sc_record.length; i++) {

           Record storage rec = sc_record[i];

           // Did the dispute begin after the receipt's start time?
           // Did the dispute finish before the receipt's end-time?
           if(rec.start >= _starttime && _expiry >= rec.end) {

              // We consider CLOSURE disputes
              // Records:
              // _i = 11, rec.round = 10, true (PISA had 11, state 10 was accepted, bad!)
              // _i = 10, rec.round = 10, false. (PISA had 10, state 10 was accepted, good!)
              // _i = 9, rec.round = 10, false (PISA had 9, state 10 was accepted, good!)
              // This is becuase the dispute only stores latest version,
              // Disputes do NOT increment the version.
              if(_channelmode == 0) {
                if(_version > rec.version) {
                  return true;
                }
              }

              // We consider COMMAND disputes
              // Records:
              // _i = 11, rec.round = 10, true (PISA had 11, state 9 was used for transition, bad)
              // _i = 10, rec.round = 10, true (PISA had 10, state 9 was used for transition, bad)
              // _i = 9, rec.round = 10, false. (PISA had 9, state 9 was used for transition, good)
              // This is because the dispute transitions version from i to i+1
              if(_channelmode == 1) {
                if(_version >= rec.version) {
                  return true;
                }
              }
           }
       }

       return false;
   }

   // Store a dispute
   function setDispute(uint _starttime, uint _expiry, uint _version, address _sc) onlyOwner public {

       // Nice thing: Constant look-up to find the caller's records (based on the day).
       Record[] storage sc_records = records[_sc];

       // Add Dispute Record
       Record memory record;
       record.start = _starttime;
       record.end = _expiry;
       record.version = _version;
       sc_records.push(record);
   }
}

// The dispute registry is responsible maintaining a list of DailyRecords.
// Right now - the implementation keeps a weeks worth of disputes, and can automatically recycle them.
// Two functions:
// - SetDispute is called by the State Channel whenever the dispute is resolved. It should store the STATE NUMBER for the final agreed state.
// - TestDispute is called by PISA, it'll look up all disputes on a given day for a state channel. And then confirm if PISA cheated.
contract DisputeRegistry {

   // Used to signal to the world about a new dispute record
   // "Day" is used to lookup the dispute record later on!
   event NewRecord(address addr, uint start, uint end, uint ctr, uint day);
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

   // _day = What day was the dispute?
   // starttime, endtime, ctr should be from the customer's receipt.
   function testReceipt(uint _channelmode, address _sc, uint _starttime, uint _endtime, uint _stateround, uint _datashard) public returns (bool) {
       DailyRecord rc = resetRecord(_datashard);

       /* return true; */
       return rc.testReceipt(_channelmode, _sc, _starttime, _endtime, _stateround);
   }

   // Checks whether the contract that keeps track of records is "fresh" for today.
   // We track every by day of week (so if it was created this day last week; we delete and re-create it)
   function resetRecord(uint _datashard) internal returns (DailyRecord) {

        DailyRecord rc;
       // Does it exist?
       // TODO: This should be the "empty address" right?
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


   // Record dispute from the sender
   // _stateround should reflect the FINAL state round accepted by the state channel!
   function setDispute(uint _starttime, uint _expiry, uint _version) public {

      // TimeInformation info = TimeInformation(timeinfo);
      uint datashard = (getDataShard(now));

      // Fetch the DailyRecord for this day. (It may reset it under the hood)
      DailyRecord rc = resetRecord(datashard);

      // Update record!
      rc.setDispute(_starttime, _expiry, _version, msg.sender);

      // If it worked... tell the world we added the record!
      emit NewRecord(msg.sender, _starttime, _expiry, _version, datashard);
   }

}
