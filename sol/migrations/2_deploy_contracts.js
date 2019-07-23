const DataRegistry = artifacts.require("DataRegistry");
const Pisa = artifacts.require("PISA");
const PisaHash = artifacts.require("PISAHash");
const ChallengeClosureContract = artifacts.require("ChallengeClosureContract");
const ChallengeCommandContract = artifacts.require("ChallengeCommandContract");
const MultiChannelContract = artifacts.require("MultiChannelContract");
// const CloseChannelHandler = artifacts.require("CloseChannelHandler");
const CommandChannelHandler = artifacts.require("CommandChannelHandler");

module.exports = function(deployer, network, accounts) {
  console.log("COLD STORAGE ACCOUNT DURING MIGRATION: " + accounts[0]);
  deployer.deploy(DataRegistry).then(function() { return deployer.deploy(Pisa, DataRegistry.address, 2, 300, accounts[0]); }).then(function() { return deployer.deploy(ChallengeClosureContract, DataRegistry.address); }).then(function() {return deployer.deploy(ChallengeCommandContract, DataRegistry.address); }).then(function() {return deployer.deploy(MultiChannelContract, DataRegistry.address); }).then(function() {return deployer.deploy(PisaHash, DataRegistry.address, 2, 300, accounts[0],  [accounts[7],accounts[8],accounts[9]])});
  // deployer.deploy(CloseChannelHandler);
  deployer.deploy(CommandChannelHandler);


};
