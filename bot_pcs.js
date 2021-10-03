#!/usr/bin/env node

require('dotenv').config();
require('@ethersproject/solidity');
require('@ethersproject/address')
const BigNumber = require('bignumber.js');
const { Fetcher, Route } = require('@pancakeswap-libs/sdk-v2')

BigNumber.config({ DECIMAL_PLACES: 0 })

const ethers = require('ethers');
const Web3 = require('web3');

const options = {
    timeout: 30000, // ms

    clientConfig: {
        // Useful if requests are large
        maxReceivedFrameSize: 100000000,   // bytes - default: 1MiB
        maxReceivedMessageSize: 100000000, // bytes - default: 8MiB

        // Useful to keep a connection alive
        keepalive: true,
        keepaliveInterval: -1 // ms
    },

    // Enable auto reconnection
    reconnect: {
        auto: true,
        delay: 1000, // ms
        maxAttempts: 10,
        onTimeout: false
    }
};

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.BSC_WSS, options)
);

const abiDecoder = require('abi-decoder');
const RouterABI = require('./UNIRouterABI.json'); // PCS Router Contract ABI
abiDecoder.addABI(RouterABI);

const privateKey = process.env.PRIVATE_KEY;
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
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    recipient: process.env.WALLET_ADDRESS
}

// The minimum ABI to get ERC20 Token balance
let minABI = [
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
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
        'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
    ],
    account
);

var wbnb, token, pairAddress, pair

async function init() {
    console.log("INITIALIZATION STARTED...")
    // const wbnb_approval = new ethers.Contract(
    //     addresses.WBNB,
    //     [
    //         'function approve(address spender, uint amount) public returns(bool)',
    //     ],
    //     account
    // );

    // const tx = await wbnb_approval.approve(
    //     router.address,
    //     '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    //     {
    //         gasPrice: mygasPriceApprove,
    //         gasLimit: 2000000
    //     }
    // );
    // const receipt = await tx.wait();

    wbnb = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(addresses.WBNB), provider);
    token = await Fetcher.fetchTokenData(56, web3.utils.toChecksumAddress(tokenToSnipe), provider);
    pairAddress = await (await Fetcher.fetchPairData(wbnb, token, provider)).liquidityToken.address;
    pair = await new web3.eth.Contract(minABI, pairAddress);

    console.log("INITIALIZATION COMPLETED")

    checkBSC(tokenToSnipe, tradeAmount, typeOfSell, profitLevel, lossLevel)
}

var tp = parseFloat(profitLevel)
var sl = parseFloat(lossLevel)

async function snipe(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel, gas) {
    tp = parseFloat(profitLevel)
    sl = parseFloat(lossLevel)

    var nonce = await web3.eth.getTransactionCount(addresses.recipient, "pending")

    const tokenIn = addresses.WBNB
    const amountIn = ethers.utils.parseUnits(tradeAmount, 18);

    console.log("#### BUYING " + tokenOut + " ####");

    const txBuy = await router.swapExactTokensForTokens(
        amountIn,
        "0",
        [tokenIn, tokenOut],
        addresses.recipient,
        Math.floor(Date.now() / 1000) + 60 * 10,
        {
            gasPrice: gas.toString(),
            gasLimit: 2000000,
            nonce: nonce,
        }
    );

    console.log('#### PURCHASED ' + tokenOut)

    console.log("#### Purchase Value in BNB: " + tradeAmount)

    const tokenApproveContract = new ethers.Contract(
        tokenOut,
        [
            'function approve(address spender, uint amount) public returns(bool)',
        ],
        account
    );

    const tx = await tokenApproveContract.approve(
        router.address,
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        {
            gasPrice: mygasPriceApprove,
            gasLimit: 2000000
        }
    );

    console.log("#### TOKEN PRE-APPROVED FOR SELLING LATER ####")

    if (typeOfSell === "T") {
        timerSell(tokenOut)
    }
    if (typeOfSell === "P") {
        profitSell(tokenOut)
    }
}

async function profitSell(tokenIn) {
    var profitValue = parseFloat(tradeAmount * tp)
    var lossValue = parseFloat(tradeAmount * sl)

    console.log("#### Take Profit Value: " + profitValue)
    console.log("#### Stop Loss Value: " + lossValue)

    let tokenContract = new web3.eth.Contract(minABI, tokenIn);
    var decimals = await tokenContract.methods.decimals().call()
    var timer = setInterval(function () {
        const timerRefresh = async (tokenIn) => {
            const pair2 = await Fetcher.fetchPairData(wbnb, token, provider);
            const route = new Route([pair2], wbnb);

            profitValue = tradeAmount * tp
            lossValue = tradeAmount * sl

            tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
            if (tokenBalanceWei <= 0) return

            var price = route.midPrice.invert().toSignificant(6)

            const balance = new BigNumber(tokenBalanceWei).div(10 ** decimals)

            var currentValue = balance * price

            const tokenName = await tokenContract.methods.name().call()

            console.log("Token Name: " + tokenName)
            console.log("Token Address: " + tokenIn)
            console.log("Current Balance: " + balance)
            console.log("Current Price: " + price)
            console.log("Current Value: " + currentValue)
            console.log("Profit Value: " + profitValue)
            console.log("Loss Value: " + lossValue)

            if (parseFloat(currentValue) >= parseFloat(profitValue)) {
                tp = tp + parseFloat(process.env.TRAILING_PROFIT_STEP)
                //                sl = (tp * (parseFloat(process.env.TRAILING_LOSS_STEP)))
                sl = (tp * 0.75)
                profitValue = parseFloat(tradeAmount * tp)
                lossValue = parseFloat(tradeAmount * sl)
                console.log("############################# New Profit Value: " + profitValue)
                console.log("############################### New Loss Value: " + lossValue)
            }

            if (parseFloat(currentValue) <= parseFloat(lossValue)) {
                try {
                    const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                        tokenBalanceWei.toString(),
                        "0",
                        [tokenIn, addresses.WBNB],
                        addresses.recipient,
                        Math.floor(Date.now() / 1000) + 60 * 10,
                        {
                            gasPrice: mygasPrice,
                            gasLimit: 2000000
                        }
                    );
                    clearInterval(timer)
                    process.exit(0)
                } catch (err) {
                    throw new Error(err)
                    process.exit(0)
                }

            }
        }
        timerRefresh(tokenIn, profitValue, lossValue)
    }, process.env.REFRESH_INTERVAL * 1000);
}

async function timerSell(tokenIn) {
    let tokenContract = new web3.eth.Contract(minABI, tokenIn);
    var timerSell = setInterval(function () {
        const timer = async (tokenIn) => {
            var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()
            if (tokenBalanceWei <= 0) return

            console.log("#### Selling after TIMER ####")

            const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                tokenBalanceWei.toString(),
                "0",
                [tokenIn, addresses.WBNB],
                addresses.recipient,
                Math.floor(Date.now() / 1000) + 60 * 10,
                {
                    gasPrice: mygasPrice,
                    gasLimit: 2000000
                }
            );
            sold = true
            console.log("#### Sold after TIMER ####")
            clearInterval(timerSell)
        }

        timer(tokenIn)
    }, 100);
}

const offendingWords = require("./honeypotRedflags.json");

async function isSafeToken(token) {
    if (process.env.BSSCAN_CHECK !== 'true') {
        return true;
    }

    if (!process.env.BSCSCAN_API_KEY) {
        console.log('BSCSCAN_API_KEY not set')
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
                if (process.env.BSSCAN_ALLOW_UNVERIFIED_TOKENS === 'true') {
                    return true;
                }

                console.log(`${token} not verified`);
                return false;
            }

            var lines = sourceObj.SourceCode.split("\n");
            if (lines.length < process.env.MIN_LINES_CONTRACT) {
                console.log("CONTRACT SOURCE CODE IS SHORTER THAN EXPECTED")
                return false
            }

            var commentedLines = []
            var commentedSection = false
            for (const line of lines) {
                if (line.indexOf("//") !== -1) {
                    commentedLines.push(line)
                }
                if (line.indexOf("/**") !== -1) {
                    commentedSection = true
                }
                if (line.indexOf("*/") !== -1) {
                    commentedSection = false
                }
                if (commentedSection === true) {
                    commentedLines.push(line)
                }
            }

            if (commentedLines.length >= process.env.MAX_COMMENTED_LINES) {
                console.log("Contract contains too many commented lines! Not buying!")
                return false
            }

            for (const word of offendingWords) {
                if (sourceObj.SourceCode.indexOf(word) !== -1) {
                    console.log(`${token} contains "${word}" - a big no-no!`);
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

var check = false;

async function checkBSC(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel) {
    if (blacklisted.includes(tokenOut.toLowerCase())) {
        console.log("TOKEN CREATOR IS BLACKLISTED. SKIPPING.")
        throw new Error("TOKEN CREATOR IS BLACKLISTED. SKIPPING.")
        //         process.exit(0)
    }

    check = await isSafeToken(tokenOut)
    if (check === true) {
        console.log("#### CONTRACT SAFE!! BUYING!")
        checkLiquidityFirst(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel)
    } else {
        console.log("#### CONTRACT NOT SAFE!! NOT BUYING!")
    }
}

async function addCreatorToBlackList(contractAddress) {
    let currentBlockNum = await web3.eth.getBlockNumber();
    let txFound = false;

    while (currentBlockNum >= 0 && !txFound) {
        const block = await web3.eth.getBlock(currentBlockNum);
        if (block !== null && block.transactions !== null) {
            const transactions = block.transactions;

            for (var t of transactions) {
                const receipt = await web3.eth.getTransactionReceipt(t);

                if (receipt.contractAddress && receipt.contractAddress.toLowerCase() === contractAddress.toLowerCase()) {
                    txFound = true;

                    contractOwner = receipt.from.toLowerCase()
                    console.log(`BLACKLISTING CONTRACT CREATOR ADDRESS: ${contractOwner}`);
                    if (!blacklisted.includes(contractOwner)) {
                        fs.appendFile(__dirname + "/blacklist", "\n" + contractOwner, function (err) {
                            if (err) return console.log(err);
                        });
                    }

                    break;
                }
            }

            currentBlockNum--;
        }
    }
}

var liquidityFound = false
var sold = false

const checkLiquidityFirst = async (tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel) => {
    pair.methods.getReserves().call().then(async (reserves) => {
        if (reserves._reserve0 !== '0' || reserves._reserve1 !== '0' && liquidityFound === false) {
            console.log("#### LIQUIDITY FOUND! BUYING!")
            liquidityFound = true
            snipe(tokenToSnipe.toLowerCase(), tradeAmount, typeOfSell, profitLevel, lossLevel, mygasPriceBuy)
        } else {
            console.log("#### LIQUIDITY NOT FOUND! WAITING!")
        }
    }).catch((err) => {
        waitForNewPairs(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel)
    });
}

function waitForNewPairs(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel) {
    factory.on('PairCreated', async (token0, token1, pairAddress) => {
        if (tokenOut.toLowerCase() === token0.toLowerCase() || tokenOut.toLowerCase() === token1.toLowerCase()) {
            console.log(`
            New pair detected
            =================
            token0: ${token0}
            token1: ${token1}
            pairAddress: ${pairAddress}
          `);
            console.log("SNIPING!")
            checkLiquidityFirst(tokenOut, tradeAmount, typeOfSell, profitLevel, lossLevel)
        }
    });
}

web3.eth.subscribe('pendingTransactions', function (error, result) { })
    .on("data", function (transactionHash) {
        web3.eth.getTransaction(transactionHash)
            .then(async function (transaction) {
                if (sold === true) return
                if (transaction === null) return
                if (transaction.input === undefined) return
                if (transaction === undefined || transaction.to === undefined || transaction.from === undefined) return

                var decodedInput = undefined;
                try {
                    decodedInput = abiDecoder.decodeMethod(transaction.input);
                    if (decodedInput === undefined || decodedInput.params === undefined) return

                    var theToken = ""
                    for (var param of decodedInput.params) {
                        if (param.name === "token" && param.value.toLowerCase() === tokenToSnipe.toLowerCase()) {
                            theToken = param.value
                        }
                        if (param.name === "tokenA" && param.value.toLowerCase() === tokenToSnipe.toLowerCase()) {
                            theToken = param.value
                        }
                        if (param.name === "tokenB" && param.value.toLowerCase() === tokenToSnipe.toLowerCase()) {
                            theToken = param.value
                        }
                    }

                    if (transaction.input !== "0x") {
                        if (decodedInput !== undefined && decodedInput.name.indexOf("removeLiquidity") > -1) {
                            if (theToken.toLowerCase() === tokenToSnipe.toLowerCase()) {
                                console.log("INCOMING RUG PULL DETECTED!")
                                console.log("SELLING EVERYTHING!")

                                let tokenContract = new web3.eth.Contract(minABI, tokenToSnipe);
                                var tokenBalanceWei = await tokenContract.methods.balanceOf(addresses.recipient).call()

                                const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                                    tokenBalanceWei.toString(),
                                    "0",
                                    [tokenToSnipe, addresses.WBNB],
                                    addresses.recipient,
                                    Math.floor(Date.now() / 1000) + 60 * 10,
                                    {
                                        gasPrice: (transaction.gasPrice * 3).toString(),
                                        gasLimit: 2000000
                                    }
                                );
                                sold = true
                            }
                        }
                    }

                    if (liquidityFound === true) return
                    if (transaction.input !== "0x") {
                        if (decodedInput !== undefined && decodedInput.name.indexOf("addLiquidity") > -1) {
                            if (theToken.toLowerCase() === tokenToSnipe.toLowerCase()) {
                                console.log("LIQUIDITY ADD DETECTED FOR " + tokenToSnipe)
                                liquidityTxHash = transaction.hash
                                snipe(tokenToSnipe.toLowerCase(), tradeAmount, typeOfSell, profitLevel, lossLevel, gasMinusOne)

                            }
                        }
                    }
                } catch (err) {

                }
            })
    })

init()