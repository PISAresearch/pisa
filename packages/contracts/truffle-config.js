const ganache = require("ganache-core")
const provider = ganache.provider({
    gasLimit: 8000000,
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});

module.exports = {
  // Uncommenting the defaults below
  // provides for an easier quick-start with Ganache.
  // You can also follow this format for other networks;
  // see <http://truffleframework.com/docs/advanced/configuration>
  // for more details on how to specify configuration options!

  networks: {
    development: {
      network_id: "*",
      gas: 8000000,
      provider: function() {
        return provider;
      },
    },
    test: {
      host: "0.0.0.0",
      port: 7545,
      network_id: "*",
      gas: 7500000
    }
  },
  compilers: {
    solc: {
      version: "0.5.0"
    }
 }
};
