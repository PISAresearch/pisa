const DataRegistry = artifacts.require("DataRegistry");
const PisaHash = artifacts.require("PISAHash");
const MultiChannelContract = artifacts.require("MultiChannelContract");
const CommandChannelHandler = artifacts.require("CommandChannelHandler");
const MockAuction = artifacts.require("MockAuction");
const MockAuctionHandler = artifacts.require("MockAuctionHandler");
const Dapp= artifacts.require("Dapp");


module.exports = function(deployer, network, accounts) {
  console.log("COLD STORAGE ACCOUNT DURING MIGRATION: " + accounts[0]);
  deployer.deploy(DataRegistry).then(function() { return deployer.deploy(MultiChannelContract, DataRegistry.address); }).then(function() {return deployer.deploy(PisaHash, DataRegistry.address, 2, 0, accounts[0], [accounts[5],accounts[6],accounts[7],accounts[8],accounts[9]], 2)});
  deployer.deploy(CommandChannelHandler);
  deployer.deploy(MockAuction);
  deployer.deploy(MockAuctionHandler);
  deployer.deploy(Dapp);


};
