// pragma solidity ^0.5.0;
// pragma experimental ABIEncoderV2;
//
// contract DataRegistryInterface {
//
//     /*
//      * Data Registry is a global contract for "temporary" storage.
//      * It will record disputes from channels (used as evidence) and PISA will store its job there.
//      */
//     function getTotalShards() public returns (uint);
//     function fetchRecord(uint _datashard, address _sc,  uint _appointmentid, uint _index) public returns (bytes memory);
// }
//
//
// contract CloseChannelHandler {
//
//     // Return TRUE if PISA failed
//     // Return FALSE if PISA did its job (or if there was a problem with the information)
//     function hasPISAFailed(uint[] memory _datashard, address _sc, uint _logid, uint[] memory _dataindex, bytes memory _postcondition, address _dataregistry) public returns (bool) {
//
//         // We should be looking up two entries!
//         require(_datashard.length == 2 && _dataindex.length == 2, "No data shard or index given");
//         // require(_datashard[0] < DataRegistryInterface(_dataregistry).getTotalShards(), "Shard is out of range");
//         // require(_datashard[1] < DataRegistryInterface(_dataregistry).getTotalShards(), "Shard is out of range");
//
//         // Fetch the "V" we promised to post.
//         uint v = abi.decode(_postcondition, (uint));
//
//         uint triggerMsg; uint startTimestamp; uint challengePeriod; uint startv;
//
//         // Let's fetch the start and resolved dispute result... did PISA do its job?
//         bytes[2] memory disputes;
//         //
//         // Fetch the "starting dispute record"
//         disputes[0] = DataRegistryInterface(_dataregistry).fetchRecord(_datashard[0], _sc, _logid, _dataindex[0]);
//
//         // Fetch the "resolved dispute record"
//         disputes[1] = DataRegistryInterface(_dataregistry).fetchRecord(_datashard[1], _sc, _logid, _dataindex[1]);
//
//         (triggerMsg, startTimestamp, challengePeriod, startv) = abi.decode(disputes[0], (uint, uint, uint, uint));
//
//         // We assume the "trigger message" identifier in the log is 0
//         require(triggerMsg == 0, "Trigger message not found");
//
//         uint resolveMsg; uint finalv;
//
//         (resolveMsg, ,finalv) = abi.decode(disputes[1], (uint, uint, uint));
//
//         require(resolveMsg == 1, "Resolve message not found");
//         require(finalv >= startv, "Start V was smaller than Final V");
//
//         uint[2] memory times;
//         times[0] = startTimestamp;
//         times[1] = challengePeriod;
//
//         // Is post-condition satisified?
//         if(finalv >= v) {
//
//           // PISA hired for "v" and it finished with a higher (or equal) v.
//           // Looks like PISA did its job
//           return (false);
//         } else {
//
//           // PISA hired for "v" and it finishes with a lower v.
//           // Looks like something went wrong, PISA didn't do its job.
//           return (true);
//         }
//     }
//
// }
