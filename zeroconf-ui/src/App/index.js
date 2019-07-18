import React, {
  Component
} from 'react';
import {
  MuiThemeProvider
} from '@material-ui/core/styles';
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
import { ethers } from 'ethers';

import './styles.scss' // global styles

const PISA_URL = "http://18.219.31.158:5487";

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
    this.setState({
      ready: false
    });
    this.web3.eth.getCoinbase((err, account) => {
      this.setState({
        account,
        ready: true
      });
    });
  };

  componentDidMount() {
    this.reloadStatus();
  }

  handlePayClicked = async () => {
    const web3 = window.web3;
    const account = web3.eth.accounts[0];
    console.log(web3.eth.accounts);
    if (account == null) {
      alert("Please unlock your MetaMask first.");
      return;
    }
    
    const receiver = "0x1C56346CD2A2Bf3202F771f50d3D14a367B48070";
    const tokenAddress = "0x722dd3f80bac40c951b51bdd28dd19d435762180";
    const amount = 20;
    const t = 0;

    const merchantPrivKey = "e3bcabc3b29956d94a87a8c75630785f1198cc661f41eedd8028a9dc2e534c6f";
    const merchantPubKey = "0x333c1941A0833FBBf348C4718faf14D0B26991b1";

    const chainId = parseInt(web3.version.network, 10);

    const hash = ethers.utils.keccak256(ethers.utils.solidityPack([ 'address', 'address', 'uint', 'uint' ], [ receiver, tokenAddress, amount, t ]));
    // const message = web3.eth.abi.encodeParameters(['address', 'address','uint','uint'], [receiver, tokenAddress, amount, t]);
    // const hash = web3.utils.keccak256(message);
    // console.log("Message:", message);
    console.log("Message hash:", hash);
    const signature = await new Promise((resolve, reject) => {
      web3.eth.sign(account, hash, (err, sig) => {
        if (err) reject(err);
        resolve(sig);
      });  
    });

    console.log("Signature:", signature);

    const transferFunction = new ethers.utils.Interface(["function transfer(address, address, uint, uint, bytes)"]).functions["transfer"];
    const encodedStuff = transferFunction.encode([receiver, tokenAddress, amount, t, signature]);

    console.log(encodedStuff);
    // prepare appointment

    const appointmentRequest = {
      challengePeriod: 100,
      contractAddress: "0x722dd3F80BAC40c951b51BdD28Dd19d435762180",
      customerAddress: merchantPubKey,
      data: encodedStuff,
      startBlock: 0,
      endBlock: 10000000,
      eventABI: "autotriggerable",
      eventArgs: "10",
      gas: 100000,
      id: 23456789, // TODO
      jobId: 0,
      mode: 0,
      postCondition: "0x",
      refund: amount
    };

    const res = await fetch(`${PISA_URL}/appointment`, {
      method: "POST",
      body: appointmentRequest
    });

    console.log(res);
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