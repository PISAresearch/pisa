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
      account: null, //current MetaMask account owner
      done: false // true if payment is completed
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

    console.log("Account:", account);
    if (account == null) {
      alert("Please unlock your MetaMask first.");
      return;
    }
    
    const receiver = "0x1C56346CD2A2Bf3202F771f50d3D14a367B48070";
    const tokenAddress = "0x722dd3f80bac40c951b51bdd28dd19d435762180";
    const amount = 8;
    const t = 1;

    const merchantPrivKey = "e3bcabc3b29956d94a87a8c75630785f1198cc661f41eedd8028a9dc2e534c6f";
    const merchantPubKey = "0x333c1941A0833FBBf348C4718faf14D0B26991b1";

    const pisaWalletContractAddress = "0x61037d3e1c4558e7ee16e25992ecf4d0eed0788e"; // PISA wallet contract address
    // const pisaWalletContractAddress = "0xdad44d2660da95b210f966689bb54eb0a4a03a05"; // PISA wallet contract address

    const chainId = parseInt(web3.version.network, 10);

    const message = web3.eth.abi.encodeParameters(['address', 'address','uint','uint', 'address'], [receiver, tokenAddress, amount, t, pisaWalletContractAddress]);
    const hash = web3.utils.keccak256(message);
    // console.log([receiver, tokenAddress, amount, t, pisaWalletContractAddress]);
    console.log("Message:", message);
    console.log("Message hash:", hash);

    //const prefix = "\x19Ethereum Signed Message:\n32";
    // const face = web3.eth.abi.encodePacked()
    // const finalHash = web3.utils.soliditySha3({
    //   t: "bytes", v: prefix
    // }, {
    //   t: "bytes32", v: hash
    // });
    // console.log("Final hash:", finalHash);

    // let prefix = "\x19Ethereum Signed Message:\n" + hash.length;
    // let msgHash1 = web3.utils.sha3(prefix+hash);

    let signature =
      await new Promise((resolve, reject) => {
        web3.eth.personal.sign(hash, account, (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      });
      // await web3.eth.personal.sign(hash, account);

    // const signature = await web3.eth.sign(hash, account);
    //const signature = (await web3.eth.accounts.sign(hash, "0x57c37c4d8b31f68798dba24176cea2a5d7b2183762cbcf5006abc5b2450429f6")).signature;
    

    console.log("Signature:", signature);

    const contract = new web3.eth.Contract([
      {
        "constant": true,
        "inputs": [],
        "name": "withdrawDelay",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "withdraw",
        "outputs": [
          {
            "name": "to",
            "type": "address"
          },
          {
            "name": "expiry",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "mutex",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_user",
            "type": "address"
          },
          {
            "name": "_pisa",
            "type": "address"
          },
          {
            "name": "_withdrawDelay",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "payable": true,
        "stateMutability": "payable",
        "type": "fallback"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "user",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "token",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "Deposit",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "token",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "expiry",
            "type": "uint256"
          }
        ],
        "name": "PendingWithdrawal",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "withdrawano",
            "type": "uint256"
          }
        ],
        "name": "CancelWithdrawal",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "withdrawano",
            "type": "uint256"
          }
        ],
        "name": "FinaliseWithdrawal",
        "type": "event"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_token",
            "type": "address"
          }
        ],
        "name": "balanceOf",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "_token",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "initiateWithdrawal",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_token",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "cancelWithdrawal",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_token",
            "type": "address"
          }
        ],
        "name": "finaliseWithdrawal",
        "outputs": [],
        "payable": true,
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getReplayCounter",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_receiver",
            "type": "address"
          },
          {
            "name": "_token",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          },
          {
            "name": "_t",
            "type": "uint256"
          },
          {
            "name": "_sig",
            "type": "bytes"
          }
        ],
        "name": "transfer",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": true,
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_hash",
            "type": "bytes32"
          },
          {
            "name": "_signature",
            "type": "bytes"
          }
        ],
        "name": "recoverEthereumSignedMessage",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "pure",
        "type": "function"
      }
    ], pisaWalletContractAddress);

    
    const result = await contract.methods.recoverEthereumSignedMessage(hash, signature).call();
    console.log(account);
    console.log(result);


    console.log(web3.eth.accounts.recover(hash, signature));

    const transferFunction = new ethers.utils.Interface(["function transfer(address, address, uint, uint, bytes)"]).functions["transfer"];
    const encodedStuff = transferFunction.encode([receiver, tokenAddress, amount, t, signature]);

    console.log(encodedStuff);
    // prepare appointment

    const appointmentRequest = {
      challengePeriod: 100,
      contractAddress: pisaWalletContractAddress,
      customerAddress: merchantPubKey,
      data: encodedStuff,
      startBlock: 0,
      endBlock: 10000000,
      eventABI: "autotriggerable",
      eventArgs: "0x",
      gas: 100000,
      id: "23456803", // TODO
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
    
    this.setState({ done: true });
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