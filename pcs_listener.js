#!/usr/bin/env node
var fs = require('fs');
var util = require('util');
var log_file = fs.createWriteStream(__dirname + '/bot.log', { flags: 'w' });
var log_stdout = process.stdout;

console.log = function (d) { //
    log_file.write(util.format(d) + '\n');
    log_stdout.write(util.format(d) + '\n');
};

require('dotenv').config();
require('@ethersproject/solidity');
require('@ethersproject/address')

const ethers = require('ethers');
const abiDecoder = require('abi-decoder');

const RouterABI = require('./UNIRouterABI.json'); // PCS Router Contract ABI

abiDecoder.addABI(RouterABI);

var cp = require('child_process');

const privateKey = "0x" + process.env.PRIVATE_KEY;

const provider = new ethers.providers.WebSocketProvider(process.env.BSC_WSS);
const wallet = new ethers.Wallet(privateKey);
const account = wallet.connect(provider);

var tradeAmount = process.env.TRADE_AMOUNT;
var typeOfSell = process.argv.slice(2)[0];
var profitLevel = process.argv.slice(2)[1];
var lossLevel = process.argv.slice(2)[2];

var alreadyPurchased = []

var liquidityTokens = ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "0xe9e7cea3dedca5984780bafc599bd69add087d56"]
fs.readFile(__dirname + "/purchased", function (err, data) {
    if (err) {
        throw err;
    }
    alreadyPurchased = data.toString().split("\n")
});

const addresses = {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    BUSD: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
    router: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
    factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    recipient: process.env.WALLET_ADDRESS
}

const factory = new ethers.Contract(
    addresses.factory,
    [
        'function getPair(address tokenA, address tokenB) external view returns (address pair)',
        'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
    ],
    account
);

function waitForNewPairs(tradeAmount, typeOfSell, profitLevel, lossLevel) {
    console.log("PCS LISTENER STARTED! WAITING FOR NEW PAIRS...")
    factory.on('PairCreated', async (token0, token1, pairAddress) => {
        console.log(`
        New pair detected
        =================
        token0: ${token0}
        token1: ${token1}
        pairAddress: ${pairAddress}
      `);
        if (liquidityTokens.includes(token0.toLowerCase())) {
            const args = [token1, tradeAmount, typeOfSell, profitLevel, lossLevel]
            cp.fork('./auto_ape.js', args, { detached: true });
        } else if (liquidityTokens.includes(token1.toLowerCase())) {
            const args = [token0, tradeAmount, typeOfSell, profitLevel, lossLevel]
            cp.fork('./auto_ape.js', args, { detached: true });
        }
    });
}

waitForNewPairs(tradeAmount.toString(), typeOfSell, profitLevel, lossLevel)
