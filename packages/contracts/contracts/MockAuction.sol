pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

// MOCK Auction contract.
// All we care about is whether the auction state is "sealbid" or "revealbid".
// In this mock, PISA only responds during the "revealbid" period.
contract MockAuction {

    // We only care about challenges
    enum Flag {SEALBID, REVEALBID}

    Flag public flag = Flag.SEALBID;

    address public lastSender;

    function transitionFlag() public {
        flag = Flag.REVEALBID;
    }

    function getAuctionFlag() public view returns(uint){
      return uint(flag);
    }

    function revealBid(uint _value, uint _r) public {
      require(flag == Flag.REVEALBID);
      lastSender = msg.sender;
      // Don't do anything.
    }

}
