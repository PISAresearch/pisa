const DisputeRegistry = artifacts.require("DisputeRegistry");
const Pisa = artifacts.require("PISA");

module.exports = function(deployer) {

  deployer.deploy(DisputeRegistry).then(function() { return deployer.deploy(Pisa, DisputeRegistry.address,2) });
};
