import React, { Component } from 'react';
import { MuiThemeProvider } from '@material-ui/core/styles';
import {
  HashRouter,
  Route,
  Redirect,
  Switch
} from 'react-router-dom';
import theme from 'configs/theme/config-theme';
import HomeView from '../components/HomeView';
import Header from '../components/Header';
import Footer from '../components/Footer';

import ZeroconfContext from '../contexts/ZeroconfContext';

import Web3 from 'web3';
import { soliditySha3, randomHex, toWei } from 'web3-utils';

import './styles.scss' // global styles

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      ready: false,
      account: null //current MetaMask account owner
    };


    if (typeof window.web3 != 'undefined') {
      this.web3Provider = window.web3.currentProvider;
    } else {
      this.web3Provider = new Web3.providers.HttpProvider('http://localhost:8545');
    }
    this.web3 = new Web3(this.web3Provider);
  }

  reloadStatus = () => {
    this.setState({ ready: false });
    this.web3.eth.getCoinbase((err, account) => {
      this.setState({ account, ready: true });
    });    
  };

  componentDidMount() {
    this.reloadStatus();
  }

  handlePayClicked = () => {
    function parseSignature(signature) {
      const r = signature.substring(0, 64);
      const s = signature.substring(64, 128);
      const v = signature.substring(128, 130);
    
      return {
          r: "0x" + r,
          s: "0x" + s,
          v: parseInt(v, 16)
      };
    }

    const web3 = this.web3;
    
    if (web3.eth.accounts[0] == null) {
      alert("Please unlock your metamask first.");
      return;
    }

    const domain = [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
    ];

    const request = [
      { name: "face", type: "string" },
    ];

    const chainId = parseInt(web3.version.network, 10);
  
    const domainData = {
      name: "Zeroconf PISA wallet",
      version: "1",
      chainId: chainId,
      verifyingContract: "0x1C56346CD2A2Bf3202F771f50d3D14a367B48070", // TODO
      salt: "0xf2d857f4a3edcb9b78b4d503bfe733db1e3f6cdc2b7971ee739626c97e86a558" //TODO
    };

    const requestData = {
      face: "off"
    };
    
    const data = JSON.stringify({
      types: {
        EIP712Domain: domain,
        Request: request
      },
      domain: domainData,
      primaryType: "Request",
      message: requestData
    });

    const signer = web3.toChecksumAddress(web3.eth.accounts[0]);

    web3.currentProvider.sendAsync(
      {
        method: "eth_signTypedData_v3",
        params: [signer, data],
        from: signer
      }, 
      function(err, result) {
        if (err || result.error) {
          return console.error(result);
        }

        const signature = parseSignature(result.result.substring(2));
        console.log("Signature", signature);
      }
    );
  };
  render() {
    const context = {
      ...this.state,
      handlePayClicked: this.handlePayClicked
    };

    return (
      <MuiThemeProvider theme={theme}>
        <ZeroconfContext.Provider value={context}>
          <HashRouter>
            <div>
              <Header />
              <Footer />
              <div className="app-shell">
                <Switch>
                  <Route path="/home" component={HomeView} />
                  <Redirect from="/" to="/home" />
                </Switch>
              </div>
            </div>
          </HashRouter>
        </ZeroconfContext.Provider>
      </MuiThemeProvider>
    );
  }
}

export default App;
