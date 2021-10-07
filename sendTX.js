#!/usr/bin/env node
require('dotenv').config();
require('@ethersproject/solidity');
require('@ethersproject/address')
const BigNumber = require('bignumber.js');
const { Fetcher, Route } = require('@pancakeswap-libs/sdk-v2')

const ethers = require('ethers');
const Web3 = require('web3');
const fs = require('fs');
const axios = require("axios")

MAX_COMMENTED_LINES = 500;
MIN_LINES_CONTRACT = 800;

const Tx = require("ethereumjs-tx").Transaction;
const Common = require('ethereumjs-common');

const common = Common.default.forCustomChain('mainnet', {
    name: 'bnb',
    networkId: 56,
    chainId: 56
}, 'petersburg');

const options = {
    clientConfig: {
        // Useful if requests are large
        maxReceivedFrameSize: 100000000,   // bytes - default: 1MiB
        maxReceivedMessageSize: 100000000, // bytes - default: 8MiB
    }
};

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.BSC_WSS, options)
);

const abiDecoder = require('abi-decoder');
const RouterABI = require('./UNIRouterABI.json'); // PCS Router Contract ABI
abiDecoder.addABI(RouterABI);

const privateKey = "0x" + process.env.PRIVATE_KEY;
const myWallet = process.env.WALLET_ADDRESS;
const burnAddress1 = '0x000000000000000000000000000000000000dead';
const burnAddress2 = '0x0000000000000000000000000000000000000000';

const provider = new ethers.providers.WebSocketProvider(process.env.BSC_WSS);
const wallet = new ethers.Wallet(privateKey);
const account = wallet.connect(provider);

const mygasPriceBuy = ethers.utils.parseUnits(process.env.GAS_PRICE, 'gwei');
const mygasPriceApprove = ethers.utils.parseUnits(process.env.GAS_PRICE, 'gwei');
const mygasPrice = ethers.utils.parseUnits(process.env.GAS_PRICE, 'gwei');

var tokenToSnipe = process.argv.slice(2)[0];
var tradeAmount = process.argv.slice(2)[1];
var typeOfSell = process.argv.slice(2)[2];
var profitLevel = process.argv.slice(2)[3];
var lossLevel = process.argv.slice(2)[4];

var alreadyPurchased = []
var blacklisted = []
var contractOwner = ""
var buyerBlacklistA = process.env.BUYER_BLACKLIST_A
var buyerBlacklistB = process.env.BUYER_BLACKLIST_B
var purchaseCompleted = false
var isDead = false

fs.readFile(__dirname + "/purchased.txt", function (err, data) {
    if (err) {
        throw err;
    }
    alreadyPurchased = data.toString().split("\n")
});

fs.readFile(__dirname + "/blacklist.txt", function (err, data) {
    if (err) {
        throw err;
    }
    blackedlisted = data.toString().split("\n")
});

const addresses = {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    router: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
    factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    recipient: process.env.WALLET_ADDRESS
}

// The minimum ABI to get ERC20 Token balance
let minABI = [
    {
        "constant": true,
        "inputs": [],
        "name": "name",
        "outputs": [{ "name": "", "type": "string" }],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
    },
    // balanceOf
    {
        "constant": true,
        "inputs": [{ "name": "_owner", "type": "address" }],
        "name": "balanceOf",
        "outputs": [{ "name": "balance", "type": "uint256" }],
        "type": "function"
    },
    // decimals
    {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [{ "name": "", "type": "uint8" }],
        "type": "function"
    },
    // getReserves
    {
        "constant": true,
        "inputs": [],
        "name": "getReserves",
        "outputs": [{ "internalType": "uint112", "name": "_reserve0", "type": "uint112" }, { "internalType": "uint112", "name": "_reserve1", "type": "uint112" }, { "internalType": "uint32", "name": "_blockTimestampLast", "type": "uint32" }],
        "type": "function"
    },
    // transfer
    {
        "constant": false,
        "inputs": [
            {
                "name": "_to",
                "type": "address"
            },
            {
                "name": "_value",
                "type": "uint256"
            }
        ],
        "name": "transfer",
        "outputs": [
            {
                "name": "",
                "type": "bool"
            }
        ],
        "type": "function"
    }
];

const factory = new ethers.Contract(
    addresses.factory,
    [
        'function getPair(address tokenA, address tokenB) external view returns (address pair)',
        'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
    ],
    account
);

const router = new ethers.Contract(
    addresses.router,
    [
        'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
        'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
        'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
    ],
    account
);

let wbnb, token, pairAddress, pair

async function sendCommission() {
    let feePercentage = tradeAmount * 0.02
    let feeFixed = 0.0008

    let fee = Math.max(feePercentage, feeFixed)

    const holder = addresses.recipient;
    const paymentAddress = '0x692199C2807D1DE5EC2f19E51d141E21D194C277' // Fees wallet - please don't change this to support further development of this bot
    const amount = web3.utils.toWei(fee.toString(), "ether")

    const nonce = await web3.eth.getTransactionCount(holder, 'latest'); // nonce starts counting from 0

    const transaction = {
        'to': paymentAddress,
        'value': amount,
        'gas': 30000,
        'nonce': nonce
    };

    const signedTx = await web3.eth.accounts.signTransaction(transaction, process.env.PRIVATE_KEY);

    // web3.eth.sendSignedTransaction(signedTx.rawTransaction, function (error, hash) {
    //     if (!error) {
    //         console.log("🎉 The hash of your transaction is: ", hash, "\n Check Alchemy's Mempool to view the status of your transaction!");
    //     } else {
    //         console.log("❗Something went wrong while submitting your transaction:", error)
    //     }
    // });
}

sendCommission()