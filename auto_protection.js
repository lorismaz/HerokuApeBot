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

var tokenToSnipe = []
var typeOfSell = "P"
var profitLevel = 1.2
var lossLevel = 0.8

var alreadyPurchased = getAllTokens();
var blacklisted = []
var contractOwner = ""
var buyerBlacklistA = process.env.BUYER_BLACKLIST_A
var buyerBlacklistB = process.env.BUYER_BLACKLIST_B
var purchaseCompleted = false
var isDead = false


function getAllTokens() {
    var apiURL = `https://deep-index.moralis.io/api/v2/${account}/erc20?chain=bsc`

    return fetch(apiURL, {
        headers:
            { 'X-API-Key': apiKey }
    })
        .then(response => response.json())
        .then(function (response) {
            let tokens = []
            response.map((token, index) => {
                const { token_address } = token
                tokens.push(token_address)
            })
            return tokens;
        })
        .catch(function (error) {
            console.log(error);
        });
}

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

async function init() {
    console.log("INITIALIZATION STARTED...")

    wbnb = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(addresses.WBNB), provider);
    token = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(tokenToSnipe), provider);
    pairAddress = await (await Fetcher.fetchPairData(wbnb, token, provider)).liquidityToken.address;
    pair = await new web3.eth.Contract(minABI, pairAddress);

    console.log("INITIALIZATION COMPLETED")
}

var lastTransactionTimestamp = new Date()

var check = false

async function search_contract_cretion_block(contract_address) {
    var highest_block = await web3.eth.getBlockNumber();
    var lowest_block = highest_block - 10000;

    var contract_code = await web3.eth.getCode(contract_address, highest_block);

    if (contract_code == "0x") {
        console.error("Contract " + contract_address + " does not exist!");
        return -1;
    }

    while (lowest_block <= highest_block) {
        let search_block = parseInt((lowest_block + highest_block) / 2)
        contract_code = await web3.eth.getCode(contract_address, search_block);


        if (contract_code != "0x") {
            highest_block = search_block;

        } else if (contract_code == "0x") {
            lowest_block = search_block;
        }

        if (highest_block == lowest_block + 1) {
            return highest_block;
        }
    }
}

async function search_contract_creator(contract_address, block) {
    var block = await web3.eth.getBlock(block);

    var transactions = block.transactions;

    for (transaction in transactions) {
        let receipt = await web3.eth.getTransactionReceipt(transactions[transaction]);

        if (receipt.contractAddress == contract_address) {
            return receipt.from
        }
    }

    return -1;
}

async function find_contract_creator(contract_address) {
    var block = await search_contract_cretion_block(contract_address);
    var creator = await search_contract_creator(contract_address, block);

    return creator;
}

var liquidityFound = false
var sold = false

web3.eth.subscribe('pendingTransactions', function (error, result) { })
    .on("data", function (transactionHash) {
        web3.eth.getTransaction(transactionHash)
            .then(async function (transaction) {
                if (sold === true) process.exit(0)
                if (transaction === null) return
                if (transaction.input === undefined) return
                if (transaction === undefined || transaction.to === undefined || transaction.from === undefined) return

                const decodedInput = abiDecoder.decodeMethod(transaction.input);
                if (decodedInput === undefined || decodedInput.params === undefined) return

                var path = ["", ""]
                var theToken = ""
                for (var param of decodedInput.params) {
                    if (param.name === "path") {
                        path = param.value
                    }
                    if (param.name === "token") {
                        theToken = param.value
                    }
                    if (param.name === "tokenA" && tokenToSnipe.includes(param.value)) {
                        theToken = param.value
                    }
                    if (param.name === "tokenB" && tokenToSnipe.includes(param.value)) {
                        theToken = param.value
                    }
                }

                if (decodedInput !== undefined && decodedInput.name.includes("swap")) {
                    if (tokenToSnipe.includes(path[0]) || tokenToSnipe.includes(path[1])) {
                        lastTransactionTimestamp = new Date()
                    }
                }

                let tokenContract = new web3.eth.Contract(minABI, tokenToSnipe);
                let tokenFrom = transaction.from.toLowerCase()
                let tokenTo = transaction.to.toLowerCase()
                //                 console.log("########## Transaction From: " + tokenFrom)
                //                 console.log("########## Transaction To: " + tokenTo)

                if (transaction.from.toLowerCase() === contractOwner.toLowerCase() && liquidityFound === true) {
                    if (decodedInput !== undefined && decodedInput.name.includes("swap")) {
                        console.log("😱 CONTRACT OWNER IS SELLING ITS OWN TOKENS. SELLING EVERYTHING. ##########")

                        try {
                            let tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                            if (tokenBalanceWei <= 0) return

                            const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                                tokenBalanceWei.toString(),
                                "0",
                                [tokenToSnipe, addresses.WBNB],
                                process.env.DESTINATION_WALLET,
                                Math.floor(Date.now() / 1000) + 60 * 10,
                                {
                                    gasPrice: (transaction.gasPrice * 5).toString(),
                                    gasLimit: 2000000
                                }
                            );

                            sold = true
                            process.exit(0)
                        } catch (err) {
                            console.log(err)
                            process.exit(0)
                        }
                    }
                }

                if (tokenFrom === buyerBlacklistA || tokenFrom === buyerBlacklistB || tokenTo === buyerBlacklistA || tokenTo === buyerBlacklistB) {
                    console.log("########## TEST - WATCHED BUYER IS MOVING TOKENS. SELLING EVERYTHING. - TEST ##########")
                }

                if (decodedInput !== undefined && decodedInput.name.includes("Tax")) {
                    if (tokenToSnipe.includes(tokenTo)) {
                        console.log("########## TAX FEE IS BEING CHANGED FOR " + tokenToSnipe + " - SELLING EVERYTHING. ##########")

                        let tokenContract = new web3.eth.Contract(minABI, tokenToSnipe);
                        var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()

                        const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                            tokenBalanceWei.toString(),
                            "0",
                            [tokenToSnipe, addresses.WBNB],
                            process.env.DESTINATION_WALLET,
                            Math.floor(Date.now() / 1000) + 60 * 10,
                            {
                                gasPrice: (transaction.gasPrice * 3).toString(),
                                gasLimit: 2000000
                            }
                        );
                        sold = true
                        process.exit(0)
                    }
                }

                if (transaction.from.toLowerCase() === contractOwner.toLowerCase()) {
                    if (tokenToSnipe.includes(path[0])) {
                        if (decodedInput !== undefined && decodedInput.name.includes("swap")) {
                            console.log("😱 WATCHED BUYER IS MOVING TOKENS. SELLING EVERYTHING. ##########")

                            try {
                                let tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                                if (tokenBalanceWei <= 0) {
                                    console.log("########## NO TOKENS OWNED - WATCHED BUYER INVOLVED, EXITING! ##########")
                                    process.exit(0)
                                }
                                const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                                    tokenBalanceWei.toString(),
                                    "0",
                                    [tokenToSnipe, addresses.WBNB],
                                    process.env.DESTINATION_WALLET,
                                    Math.floor(Date.now() / 1000) + 60 * 10,
                                    {
                                        gasPrice: (transaction.gasPrice * 5).toString(),
                                        gasLimit: 2000000
                                    }
                                );
                                sold = true
                                process.exit(0)
                            } catch (err) {
                                console.log(err)
                                process.exit(0)
                            }
                        }
                    }
                }

                if (tokenFrom === myWallet && (tokenTo === burnAddress1 || tokenTo === burnAddress2)) {
                    console.log("########## Tokens being burned. SELLING EVERYTHING. ##########")

                    try {
                        let tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                        if (tokenBalanceWei <= 0) {
                            console.log("########## NO TOKENS OWNED - TOKENS BEING SENT TO THE BURN ADDRESS, SELLING EVERYTHING. ##########")
                            process.exit(0)
                        }
                        const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                            tokenBalanceWei.toString(),
                            "0",
                            [tokenToSnipe, addresses.WBNB],
                            process.env.DESTINATION_WALLET,
                            Math.floor(Date.now() / 1000) + 60 * 10,
                            {
                                gasPrice: (transaction.gasPrice * 5).toString(),
                                gasLimit: 2000000
                            }
                        );
                        sold = true
                        process.exit(0)
                    } catch (err) {
                        console.log(err)
                        process.exit(0)
                    }
                }

                if (decodedInput !== undefined && decodedInput.name.includes("removeLiquidity")) {
                    if (theToken.toLowerCase() === tokenToSnipe.toLowerCase() || decodedInput.params[0].value.toLowerCase() === tokenToSnipe.toLowerCase() || decodedInput.params[1].value.toLowerCase() === tokenToSnipe.toLowerCase()) {
                        if (check === true && sold === false) {
                            console.log("😱 INCOMING RUG PULL DETECTED!")
                            console.log("SELLING EVERYTHING!")

                            try {
                                var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                                if (tokenBalanceWei <= 0) return

                                const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                                    tokenBalanceWei.toString(),
                                    "0",
                                    [tokenToSnipe, addresses.WBNB],
                                    process.env.DESTINATION_WALLET,
                                    Math.floor(Date.now() / 1000) + 60 * 10,
                                    {
                                        gasPrice: (transaction.gasPrice * 5).toString(),
                                        gasLimit: 2000000
                                    }
                                );
                                sold = true
                                process.exit(0)
                            } catch (err) {
                                console.log(err)
                                process.exit(0)
                            }
                        }
                    }
                }

                var seconds = (new Date().getTime() - lastTransactionTimestamp.getTime()) / 1000;

                if (seconds >= parseInt(process.env.DEAD_TOKEN_TIME_SECONDS) && isDead === false) {
                    console.log(tokenName + " LOOKS DEAD. SELLING EVERYTHING")

                    try {
                        var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                        if (tokenBalanceWei <= 0) return

                        const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                            tokenBalanceWei.toString(),
                            "0",
                            [tokenToSnipe, addresses.WBNB],
                            process.env.DESTINATION_WALLET,
                            Math.floor(Date.now() / 1000) + 60 * 10,
                            {
                                gasPrice: (transaction.gasPrice * 5).toString(),
                                gasLimit: 2000000
                            }
                        );

                        isDead = true

                    } catch (err) {
                        console.log(err)
                        process.exit(0)
                    }
                }
            })
    })