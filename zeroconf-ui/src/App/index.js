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


    const web3 = new Web3(Web3.givenProvider || "http://localhost:8545")

    this.web3 = web3;
    window.web3 = web3;
  }

  reloadStatus = async () => {
    const accounts = await web3.eth.getAccounts()
    this.setState({ ready: true, account: accounts[0] })
  };

  componentDidMount() {
    this.reloadStatus();
  }

  handlePayClicked = async () => {
    const web3 = this.web3;  // use local Web3 instead  of Metamask's

    const account = this.state.account;
    if (account == null) {
      alert("Please unlock your MetaMask first.");
      return;
    }
    
    const receiver = "0x1C56346CD2A2Bf3202F771f50d3D14a367B48070";
    const tokenAddress = "0x722dd3f80bac40c951b51bdd28dd19d435762180";
    const amount = 24;
    const t = 0;

    const merchantPrivKey = "e3bcabc3b29956d94a87a8c75630785f1198cc661f41eedd8028a9dc2e534c6f";
    const merchantPubKey = "0x333c1941A0833FBBf348C4718faf14D0B26991b1";

    const chainId = parseInt(web3.version.network, 10);

    const message = web3.eth.abi.encodeParameters(['address', 'address','uint','uint'], [receiver, tokenAddress, amount, t]);
    const hash = web3.utils.keccak256(message);
    console.log("Message:", message);
    console.log("Message hash:", hash);

    const signature = await new Promise((resolve, reject) => {
      web3.eth.sign(hash, account, (err, sig) => {
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
      contractAddress: "0xd4467e9CF86f1c4185fd8e66596C3AB5Ee44e14F",
      customerAddress: merchantPubKey,
      data: encodedStuff,
      startBlock: 0,
      endBlock: 10000000,
      eventABI: "autotriggerable",
      eventArgs: "0x",
      gas: 100000,
      id: "23456793", // TODO
      jobId: 0,
      mode: 0,
      postCondition: "0x",
      refund: amount
    };
    console.log(appointmentRequest);

    const res = await fetch(`${PISA_URL}/appointment`, {
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(appointmentRequest)
    });

    console.log(await res.json());
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