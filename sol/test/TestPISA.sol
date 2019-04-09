pragma solidity >=0.4.25 <0.6.0;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/PISA.sol";
import "../contracts/DisputeRegistry.sol";

contract TestDeployment {

  // Test that both contracts are deployed and that PISA is aware of the dispute registry
  function testRegistry() public {
    PISA pisa = PISA(DeployedAddresses.PISA());
    DisputeRegistry registry = DisputeRegistry(DeployedAddresses.DisputeRegistry());

    Assert.equal(pisa.disputeregistry(), address(registry), "DisputeRegistry address should match");
  }

}
