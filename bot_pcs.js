#!/usr/bin/env node
require('dotenv').config();
require('@ethersproject/solidity');
require('@ethersproject/address')
const BigNumber = require('bignumber.js');
const { Fetcher, Route, Pair } = require('@pancakeswap-libs/sdk-v2')

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

const provider = new ethers.providers.WebSocketProvider(process.env.BSC_WSS);
const wallet = new ethers.Wallet(privateKey);
const account = wallet.connect(provider);

const mygasPriceBuy = ethers.utils.parseUnits(process.env.GAS_PRICE, 'gwei');
const mygasPriceApprove = ethers.utils.parseUnits(process.env.GAS_PRICE, 'gwei');
const mygasPrice = ethers.utils.parseUnits(process.env.GAS_PRICE, 'gwei');

let tokenToSnipe = process.argv.slice(2)[0];
let tradeAmount = process.argv.slice(2)[1];
let typeOfSell = process.argv.slice(2)[2];
let profitLevel = process.argv.slice(2)[3];
let lossLevel = process.argv.slice(2)[4];

let contractOwner = ""
let alreadyPurchased = []
let blacklisted = []
let buyerBlacklistA = process.env.BUYER_BLACKLIST_A
let buyerBlacklistB = process.env.BUYER_BLACKLIST_B
let purchaseCompleted = false
let isDead = false
let tokenName = ""

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
    wbnb = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(addresses.WBNB), provider);
    token = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(tokenToSnipe), provider);
    pairAddress = await (await Fetcher.fetchPairData(wbnb, token, provider)).liquidityToken.address;
    pair = await new web3.eth.Contract(minABI, pairAddress);

    checkBSC(tokenToSnipe, tradeAmount, typeOfSell, profitLevel, lossLevel, mygasPriceBuy)
}

var lastTransactionTimestamp = new Date()

var tp = parseFloat(profitLevel)
var sl = parseFloat(lossLevel)

async function snipe(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel, smartGas) {
    tp = parseFloat(profitLevel)
    sl = parseFloat(lossLevel)

    var nonce = await web3.eth.getTransactionCount(addresses.recipient, "latest")

    const tokenIn = addresses.WBNB
    const amountIn = web3.utils.toWei(tradeAmount, "ether");

    console.log("BUYING " + tokenOut);

    await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
        "0",
        [tokenIn, tokenOut],
        addresses.recipient,
        Math.floor(Date.now() / 1000) + 60 * 10,
        {
            gasPrice: smartGas.toString(),
            gasLimit: 2000000,
            nonce: nonce,
            value: amountIn.toString()
        }
    )

    console.log('PURCHASED ' + tokenOut)

    console.log("Purchase Value in BNB: " + tradeAmount)

    const tokenApproveContract = new ethers.Contract(
        tokenOut,
        [
            'function approve(address spender, uint amount) public returns(bool)',
        ],
        account
    );

    await tokenApproveContract.approve(
        router.address,
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        {
            gasPrice: mygasPriceApprove,
            gasLimit: 2000000,
            nonce: nonce + 1
        }
    ).then(x => console.log(x.toString()))

    console.log("TOKEN PRE-APPROVED FOR SELLING LATER")

    if (typeOfSell === "P") {
        profitSell(tokenOut)
    }
}

async function profitSell(tokenIn) {
    const wbnb = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(addresses.WBNB), provider);
    const token = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(tokenIn), provider);

    var profitValue = parseFloat(tradeAmount * tp)
    var lossValue = parseFloat(tradeAmount * sl)

    console.log("#### Take Profit Value: " + profitValue)
    console.log("#### Stop Loss Value: " + lossValue)

    let tokenContract = new web3.eth.Contract(minABI, tokenIn);
    var decimals = await tokenContract.methods.decimals().call()
    var timer = setInterval(function () {
        const timerRefresh = async (tokenIn) => {
            const route = new Route([pairAddress], wbnb);

            profitValue = tradeAmount * tp
            lossValue = tradeAmount * sl

            var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
            if (tokenBalanceWei <= 0) return

            var price = route.midPrice.invert().toSignificant(6)

            const balance = new BigNumber(tokenBalanceWei).div(10 ** decimals)

            var currentValue = balance * price

            console.log("Current Balance: " + balance)
            console.log("Current Price: " + price)
            console.log("Current Value: " + currentValue)
            console.log("Profit Value: " + profitValue)
            console.log("Loss Value: " + lossValue)

            if (parseFloat(currentValue) >= parseFloat(profitValue) || parseFloat(currentValue) <= parseFloat(lossValue)) {
                await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                    tokenBalanceWei.toString(),
                    "0",
                    [tokenIn, addresses.WBNB],
                    addresses.recipient,
                    Math.floor(Date.now() / 1000) + 60 * 10,
                    {
                        gasPrice: mygasPrice.toString(),
                        gasLimit: 2000000
                    }
                ).then(x => {
                    sold = true
                    clearInterval(timer)
                })
            }
        }
        timerRefresh(tokenIn, profitValue, lossValue)
    }, process.env.REFRESH_INTERVAL * 1000);
}

const offendingWords = require("./honeypotRedflags.json");

async function isSafeToken(token) {
    if (process.env.BSSCAN_CHECK !== 'true') {
        return true;
    }

    if (!process.env.BSCSCAN_API_KEY) {
        console.log('BSCSCAN_API_KEY not set')
        process.exit(0)
    }

    let response = null;
    try {
        response = await axios.get(`https://api.bscscan.com/api?module=contract&action=getsourcecode&address=${token.toLowerCase()}&apikey=${process.env.BSCSCAN_API_KEY}`);
    } catch (e) {
        console.log(`Error while testing ${token}`, e);
        return false;
    }

    if (response.data.message === 'OK') {
        for (const sourceObj of response.data.result) {
            if (!sourceObj.SourceCode) {
                console.log("############### " + token + " not verified - EXITING\n");
                return false;
            }

            var lines = sourceObj.SourceCode.split("\n");
            if (lines.length < MIN_LINES_CONTRACT) {
                console.log("CONTRACT SOURCE CODE IS SHORTER THAN EXPECTED")
                return false
            }

            var commentedLines = []
            var commentedSection = false
            for (const line of lines) {
                if (line.includes("//")) {
                    commentedLines.push(line)
                }
                if (line.includes("/**")) {
                    commentedSection = true
                }
                if (line.includes("*/")) {
                    commentedSection = false
                }
                if (commentedSection === true) {
                    commentedLines.push(line)
                }
            }

            if (commentedLines.length >= MAX_COMMENTED_LINES) {
                console.log("Contract contains too many commented lines! Not buying!")
                return false
            }

            for (const word of offendingWords) {
                if (sourceObj.SourceCode.includes(word)) {
                    console.log("############### " + token + " contains " + word + " - a known Red Flag");
                    return false;
                }
            }
        }

        return true;
    }

    if (process.env.BSSCAN_ALLOW_UNVERIFIED_TOKENS === 'true') {
        return true;
    }

    if (response.data.message === 'NOTOK' && response.data.result === 'Contract source code not verified') {
        this.logger.log(`${token} not verified`);
        return false;
    }

    return false;
}

async function addCreatorToBlackList(contractAddress) {
    console.log("BLACKLISTING CONTRACT CREATOR ADDRESS: " + contractOwner);
    if (!blacklisted.includes(contractOwner.toLowerCase())) {
        fs.appendFile(__dirname + "/blacklist.txt", "\n" + contractOwner, function (err) {
            if (err) return console.log(err);
        });
    }
    process.exit(0)
}

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

async function checkBSC(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel) {
    let tokenContract = new web3.eth.Contract(minABI, tokenOut);
    tokenName = await tokenContract.methods.name().call()

    contractOwner = await find_contract_creator(tokenOut)
    if (contractOwner == -1) {
        console.log("Contract owner address too far in the past. Skipping this token for performance.")
        process.exit(0)
    }

    console.log("Contract Owner address is: " + contractOwner);

    if (blacklisted.includes(contractOwner)) {
        console.log("TOKEN CREATOR IS BLACKLISTED. SKIPPING.")
        process.exit(0)
    }

    check = await isSafeToken(tokenOut)

    if (check === true) {
        console.log("??? CONTRACT SAFE!! BUYING " + tokenName + "!")
        checkLiquidityFirst(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel)
    } else {
        console.log("???? CONTRACT NOT SAFE!! NOT BUYING " + tokenName + "!\n")
        addCreatorToBlackList(tokenOut)
        process.exit(0)
    }
}

var liquidityFound = false
var sold = false

const checkLiquidityFirst = async (tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel) => {
    try {
        var reserves = await pair.methods.getReserves().call()

        if ((reserves._reserve0 !== '0' || reserves._reserve1 !== '0') && liquidityFound === false) {
            console.log("???? LIQUIDITY FOUND! BUYING!")
            liquidityFound = true
            snipe(tokenOut.toLowerCase(), tradeAmount, typeOfSell, profitLevel, lossLevel, mygasPriceBuy)
        } else {
            console.log("???? LIQUIDITY NOT FOUND! WAITING FOR LIQUIDITY ADD EVENT IN MEMPOOL!")
        }
    } catch (err) {
        console.log(err)
        process.exit(0)
    }
}

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
                    if (param.name === "tokenA" && param.value === tokenToSnipe.toLowerCase()) {
                        theToken = param.value
                    }
                    if (param.name === "tokenB" && param.value === tokenToSnipe.toLowerCase()) {
                        theToken = param.value
                    }
                }

                if (decodedInput !== undefined && decodedInput.name.includes("swap")) {
                    if (path[0].toLowerCase() === tokenToSnipe.toLowerCase() || path[path.length - 1].toLowerCase() === tokenToSnipe.toLowerCase()) {
                        lastTransactionTimestamp = new Date()
                    }
                }

                let tokenContract = new web3.eth.Contract(minABI, tokenToSnipe);
                let tokenFrom = transaction.from.toLowerCase()
                let tokenTo = transaction.to.toLowerCase()
                //                 console.log("########## Transaction From: " + tokenFrom)
                //                 console.log("########## Transaction To: " + tokenTo)

                if (transaction.from.toLowerCase() === contractOwner.toLowerCase()) {
                    if (decodedInput !== undefined && decodedInput.name.includes("swap")) {
                        console.log("???? CONTRACT OWNER IS SELLING ITS OWN TOKENS. SELLING EVERYTHING. ##########")

                        try {
                            let tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                            if (tokenBalanceWei <= 0) return

                            await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                                tokenBalanceWei.toString(),
                                "0",
                                [tokenToSnipe, addresses.WBNB],
                                process.env.DESTINATION_WALLET,
                                Math.floor(Date.now() / 1000) + 60 * 10,
                                {
                                    gasPrice: (transaction.gasPrice * 5).toString(),
                                    gasLimit: 2000000
                                }
                            ).then(x => {
                                sold = true
                                process.exit(0)
                            })
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
                    if (tokenTo.toLowerCase() === tokenToSnipe.toLowerCase()) {
                        console.log("########## TAX FEE IS BEING CHANGED FOR " + tokenToSnipe + " - SELLING EVERYTHING. ##########")

                        let tokenContract = new web3.eth.Contract(minABI, tokenToSnipe);
                        var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()

                        await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                            tokenBalanceWei.toString(),
                            "0",
                            [tokenToSnipe, addresses.WBNB],
                            process.env.DESTINATION_WALLET,
                            Math.floor(Date.now() / 1000) + 60 * 10,
                            {
                                gasPrice: (transaction.gasPrice * 3).toString(),
                                gasLimit: 2000000
                            }
                        ).then(x => {
                            sold = true
                            process.exit(0)
                        })
                    }
                }

                if (transaction.from.toLowerCase() === contractOwner.toLowerCase()) {
                    if (path[0].toLowerCase() === tokenToSnipe.toLowerCase()) {
                        if (decodedInput !== undefined && decodedInput.name.includes("swap")) {
                            console.log("???? WATCHED BUYER IS MOVING TOKENS. SELLING EVERYTHING. ##########")

                            try {
                                let tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                                if (tokenBalanceWei <= 0) {
                                    console.log("########## NO TOKENS OWNED - WATCHED BUYER INVOLVED, EXITING! ##########")
                                    process.exit(0)
                                }
                                await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                                    tokenBalanceWei.toString(),
                                    "0",
                                    [tokenToSnipe, addresses.WBNB],
                                    process.env.DESTINATION_WALLET,
                                    Math.floor(Date.now() / 1000) + 60 * 10,
                                    {
                                        gasPrice: (transaction.gasPrice * 5).toString(),
                                        gasLimit: 2000000
                                    }
                                ).then(x => {
                                    sold = true
                                    process.exit(0)
                                })
                            } catch (err) {
                                console.log(err)
                                process.exit(0)
                            }
                        }
                    }
                }

                if (tokenFrom === myWallet && tokenTo.includes("0x0000000000000") > -1) {
                    console.log("########## Tokens being redirected. SELLING EVERYTHING. ##########")

                    try {
                        let tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                        if (tokenBalanceWei <= 0) {
                            console.log("########## NO TOKENS OWNED - TOKENS BEING SENT TO THE BURN ADDRESS, SELLING EVERYTHING. ##########")
                            process.exit(0)
                        }
                        await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                            tokenBalanceWei.toString(),
                            "0",
                            [tokenToSnipe, addresses.WBNB],
                            process.env.DESTINATION_WALLET,
                            Math.floor(Date.now() / 1000) + 60 * 10,
                            {
                                gasPrice: (transaction.gasPrice * 5).toString(),
                                gasLimit: 2000000
                            }
                        ).then(x => {
                            sold = true
                            process.exit(0)
                        })
                    } catch (err) {
                        console.log(err)
                        process.exit(0)
                    }
                }

                if (decodedInput !== undefined && decodedInput.name.includes("removeLiquidity")) {
                    if (theToken.toLowerCase() === tokenToSnipe.toLowerCase() || decodedInput.params[0].value.toLowerCase() === tokenToSnipe.toLowerCase() || decodedInput.params[1].value.toLowerCase() === tokenToSnipe.toLowerCase()) {
                        if (check === true && sold === false) {
                            console.log("???? INCOMING RUG PULL DETECTED!")
                            console.log("SELLING EVERYTHING!")

                            try {
                                var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
                                if (tokenBalanceWei <= 0) return

                                await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                                    tokenBalanceWei.toString(),
                                    "0",
                                    [tokenToSnipe, addresses.WBNB],
                                    process.env.DESTINATION_WALLET,
                                    Math.floor(Date.now() / 1000) + 60 * 10,
                                    {
                                        gasPrice: (transaction.gasPrice * 5).toString(),
                                        gasLimit: 2000000
                                    }
                                ).then(x => {
                                    sold = true
                                    process.exit(0)
                                })
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

                        await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                            tokenBalanceWei.toString(),
                            "0",
                            [tokenToSnipe, addresses.WBNB],
                            process.env.DESTINATION_WALLET,
                            Math.floor(Date.now() / 1000) + 60 * 10,
                            {
                                gasPrice: (transaction.gasPrice * 5).toString(),
                                gasLimit: 2000000
                            }
                        ).then(x => {
                            isDead = true
                            process.exit(0)
                        })

                    } catch (err) {
                        console.log(err)
                        process.exit(0)
                    }
                }

                if (liquidityFound === true) return
                if (decodedInput !== undefined && decodedInput.name.indexOf("addLiquidity") > -1) {
                    if (theToken.toLowerCase() === tokenToSnipe.toLowerCase() || path[0].toLowerCase() === tokenToSnipe.toLowerCase() || path[path.length - 1].toLowerCase() === tokenToSnipe.toLowerCase()) {
                        console.log("???? LIQUIDITY ADD DETECTED FOR " + tokenName);
                        liquidityFound = true
                        var smartGas = Math.max(transaction.gasPrice, mygasPriceBuy)
                        snipe(tokenToSnipe.toLowerCase(), tradeAmount, typeOfSell, profitLevel, lossLevel, smartGas)
                    }
                }
            })
    })

init();
