pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract DataRegistryInterface {

    /*
     * Data Registry is a global contract for "temporary" storage.
     * It will record disputes from channels (used as evidence) and PISA will store its job there.
     */
    function getTotalShards() public returns (uint);
    function fetchRecord(uint _datashard, address _sc,  uint _appointmentid, uint _index) public returns (bytes memory);
    function fetchHash(uint _datashard, address _sc,  uint _appointmentid, uint _index) public returns (bytes32);
}


/*
 * We have implemented two ways to check if the job is complete.
 * 1. The first "CheckJob" accepts the _logdata and checks the hash commitment in data registry
 * 2. The second "CheckJob" fetches the _logdata from the data registry
 */
contract CommandChannelHandler {


  function basicShardSanityChecks(uint[] memory _datashard, uint[] memory _dataindex, address _dataregistry) internal {
    // We should be looking up two entries!
    require(_datashard.length == 2 && _dataindex.length == 2, "No data shard or index given");
    require(_datashard[0] < DataRegistryInterface(_dataregistry).getTotalShards(), "Shard is out of range");
    require(_datashard[1] < DataRegistryInterface(_dataregistry).getTotalShards(), "Shard is out of range");

     // It should be the NEXT entry.... not a future entry...
     // [trigger,refute] events should directly follow each other...
     // we must avoid the situation [trigger,...,refute] as while
     // it is not obvious how it can hurt an honest PISA, we must avoid that.
    require(_dataindex[1] - _dataindex[0] == 1);

  }

  // CHECKS HASH COMMITMENT
  // Return TRUE if PISA failed
  // Return FALSE if PISA did its job (or if there was a problem with the information)
  function checkJob(uint[] memory _datashard, address _sc, uint _logid, uint[] memory _dataindex, bytes[] memory _logdata, bytes memory _postcondition, address _dataregistry) public returns (uint[2] memory times, bool) {

      // Check shard information
      basicShardSanityChecks(_datashard, _dataindex, _dataregistry);

      // Fetch the "starting dispute record"
      // Does the log data match up with on-chain commitment?
      bytes32 h = DataRegistryInterface(_dataregistry).fetchHash(_datashard[0], _sc, _logid, _dataindex[0]);
      require(h == keccak256(_logdata[0]));

      // Fetch the "resolved dispute record"
      // Does the log data match up with the on-chain commitment?
      h = DataRegistryInterface(_dataregistry).fetchHash(_datashard[1], _sc, _logid, _dataindex[1]);
      require(h == keccak256(_logdata[1]));

      return decodeAndCheck(_logdata, _postcondition);
  }

  // Fetches data from the data registry!
  // Return TRUE if PISA failed
  // Return FALSE if PISA did its job (or if there was a problem with the information)
  function checkJob(uint[] memory _datashard, address _sc, uint _logid, uint[] memory _dataindex, bytes memory _postcondition, address _dataregistry) public returns (uint[2] memory, bool) {
      // Check shard information
      basicShardSanityChecks(_datashard, _dataindex, _dataregistry);

      // Let's fetch the start and resolved dispute result... did PISA do its job?
      bytes[] memory logdata;

      // Fetch the "starting dispute record"
      logdata[0] = DataRegistryInterface(_dataregistry).fetchRecord(_datashard[0], _sc, _logid, _dataindex[0]);

      // Fetch the "resolved dispute record"
      logdata[1] = DataRegistryInterface(_dataregistry).fetchRecord(_datashard[1], _sc, _logid, _dataindex[1]);

      return decodeAndCheck(logdata, _postcondition);

  }

  // Does all the hard work to decode logs and post condition to check result
  function decodeAndCheck(bytes[] memory _logdata, bytes memory _postcondition) internal pure returns (uint[2] memory, bool) {

      // Fetch the "V" we promised to post.
      uint v = abi.decode(_postcondition, (uint));
      uint triggerMsg; uint startTimestamp; uint challengePeriod; uint startv;
      uint resolveMsg; uint finalv;
      (triggerMsg, startTimestamp, challengePeriod, startv) = abi.decode(_logdata[0], (uint, uint, uint, uint));
      (resolveMsg, ,finalv) = abi.decode(_logdata[1], (uint, uint, uint));

      require(triggerMsg == 0, "Trigger message not found");
      require(resolveMsg == 1, "Resolve message not found");
      require(startv+1 == finalv, "Final v should only increment by 1");

      uint[2] memory times;
      times[0] = startTimestamp;
      times[1] = challengePeriod;

      // PISA should respond with "state v" that cancels the dispute.
      // Thus if there is a state transition on-chain, it should ALWAYS be greater than v.
      // Otherwise... PISA could have cancelled it!
      if(finalv > v) {

        // PISA hired for "v" and it finished with a higher  v.
        // Looks like PISA did its job
        return (times, false);
      } else {

        // PISA hired for "v" and it finishes with a lower v.
        // Looks like something went wrong, PISA didn't do its job.
        return (times, true);
      }
  }
}
