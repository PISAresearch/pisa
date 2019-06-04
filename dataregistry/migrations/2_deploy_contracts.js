const DataRegistry = artifacts.require("DataRegistry");
const Pisa = artifacts.require("PISA");

module.exports = function(deployer) {

  deployer.deploy(DataRegistry).then(function() { return deployer.deploy(Pisa, DataRegistry.address,2) });
};
