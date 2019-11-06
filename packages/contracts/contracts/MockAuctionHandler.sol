pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

// We only care about the auction flag
contract MockAuctionInterface {

  function getAuctionFlag() public returns (uint);
}

contract MockAuctionHandler {

  // PISA should only respond... when the auction flag is in the "REVEALBID" mode.
  function canPISARespond(address _sc, address _cus, bytes memory _precondition) public returns(bool) {

    // Super simple example
    // We don't care about "cus" or "precondition" for now.
    // Future, it will be useful.
    if(MockAuctionInterface(_sc).getAuctionFlag() == 1) {
      return true;
    }

    return false;

  }

}
