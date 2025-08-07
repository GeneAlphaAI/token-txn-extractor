const { Web3 } = require("web3");
const axios = require("axios");
const Bottleneck = require("bottleneck");
const fastCsv = require("fast-csv");
const fs = require("fs");
const path = require("path");
const erc20ABI_Bytes32 = require("../resources/ABIs/erc20ABI-Bytes32.json");
const erc20_ABI = require("../resources/ABIs/ERC20_ABI.json");
// const Config = require("./config");
const logger = require("./logger");
const {
  RPC_WEBSOCKET,
  RPC_HTTP,

  WETH_ADDRESS,
  DAI_ADDRESS,
  USDT_ADDRESS,
  USDC_ADDRESS,
  TUSD_ADDRESS,
  USDP_ADDRESS,
  WBTC_ADDRESS,

  // Topics
  TRANSFER_TOPIC,
  TRANSFER_FROM_TOPIC,

  // Routers
  UNIVERSAL_ROUTER_V4,
  ROUTER2_V2,
  SWAP_ROUTER_V3,
  UNIVERSAL_ROUTER,
  UNIVERSAL_ROUTER_2,
  AGGREGATION_ROUTER_V6,
  V3_OLD_ROUTER,
  ONE_INCH_V5_AGGREGATION_ROUTER,
  ONE_INCH_DEPLOYER_4,
  ONE_INCH_V4,
  ZERO_X_EXCHANGE_PROXY_ROUTER,
  UNI_BOT_ROUTER,
  KyberSwap_Meta_Aggregation_Router_V2,
  TransitSwap_V5_Router,
  Sushiswap_Router,
  Banana_Gun_Router,
  Banana_Gun_V2_Router,
  Maestro_Router,
  Maestro_Router_2,
  MEV_Bot_Router,
  Mev_Bot_Router2,
  Mev_Bot_Router3,
  Mev_Bot_Router4,
  Metamask_Swap_Router,
  OKX_DEX_Aggregation_Router,
  Paraswap_V5_Augustus_Swapper,
  Seawise_Resolver,
  Cow_Protocol_GPv2Settlement,
  DEBRIDGE_PROXY_FORWARDER,

  Unknown_Router,
  Unknown_Router2,
  Unknown_Router3,
  Unknown_Router4,
  Unknown_Router5,
  Unknown_Router6,
  Unknown_Router7,
  Unknown_Router8,
  Unknown_Router9,
  Unknown_Router10,
  Unknown_Router11,
  Unknown_Router12,
  Unknown_Router13,
  Unknown_Router14,
  Unknown_Router15,
} = process.env;

// Connection variables with renamed internal vars
let blockchainHttpProvider = new Web3(
  new Web3.providers.HttpProvider(RPC_HTTP)
);
let blockchainWsProvider = new Web3(
  new Web3.providers.WebsocketProvider(RPC_WEBSOCKET)
);

// Reordered functions and changed internal variable names
const priceStorage = new Map();

const tokenPriceHistoryETH = new Map();
const tokenPriceHistoryBTC = new Map();
const tokenPriceHistoryETH_1h = new Map();

const requestLimiter = new Bottleneck({
  reservoir: 5,
  reservoirRefreshAmount: 5,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 1,
  minTime: 2000,
});

function formatDateFromTimestamp(timestampValue) {
  const dateObj = new Date(timestampValue * 1000);
  const day = String(dateObj.getUTCDate()).padStart(2, "0");
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const year = dateObj.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

async function retrieveHistoricalPriceFromAPI(coinType, timestampValue) {
  try {
    const dateString = formatDateFromTimestamp(timestampValue);
    const coinIdentifier = coinType === "bitcoin" ? "bitcoin" : "ethereum";
    const apiUrl = `https://api.coingecko.com/api/v3/coins/${coinIdentifier}/history?date=${dateString}`;

    const response = await requestLimiter.schedule(() => axios.get(apiUrl));
    return response.data.market_data.current_price.usd;
  } catch (err) {
    console.error(`Error fetching price for ${coinType}:`, err.message);
    return null;
  }
}



async function fetchHistoricalPriceData(coinType, timestampValue) {
  const hourValue = Math.floor(timestampValue / 3600) * 3600;
  const storageKey = `${coinType}-${hourValue}`;
  if (priceStorage.has(storageKey)) return priceStorage.get(storageKey);

  try {
    const priceData = await retrieveHistoricalPriceFromAPI(
      coinType,
      timestampValue
    );
    priceStorage.set(storageKey, priceData);
    return priceData;
  } catch (error) {
    console.error(
      `❌ Error fetching ${coinType} price at ${formatDateFromTimestamp(
        timestampValue
      )}: ${error.response?.status || error.message}`
    );
    return null;
  }
}

function initializeTokenPricesFromFiles(
  ethDataFile = path.resolve(__dirname, "../resources/ETHUSD_1m_Binance.csv"),
  btcDataFile = path.resolve(__dirname, "../resources/btc_1h_data_2018_to_2025.csv"),
  bybitEthFile = path.resolve(__dirname, "../resources/BYBIT_ETHUSDT_1h.csv")
) {
  tokenPriceHistoryETH.clear();
  tokenPriceHistoryBTC.clear();
  tokenPriceHistoryETH_1h.clear(); // ← Add this map globally to store hourly ETH data from BYBIT

  return new Promise((resolve, reject) => {
    fs.createReadStream(ethDataFile)
      .pipe(fastCsv.parse({ headers: true, trim: true }))
      .on("data", (rowData) => {
        try {
          const timestamp = new Date(rowData["Open time"]).getTime();
          const minuteTimestamp = Math.floor(timestamp / 1000);
          const closingPrice = parseFloat(rowData.Close);
          tokenPriceHistoryETH.set(minuteTimestamp, closingPrice);
        } catch (error) {
          console.error("Error processing ETH minute data:", error);
        }
      })
      .on("end", () => {
        console.log(`Loaded ${tokenPriceHistoryETH.size} ETH minute prices`);

        fs.createReadStream(btcDataFile)
          .pipe(fastCsv.parse({ headers: true, trim: true }))
          .on("data", (rowData) => {
            const timestamp = new Date(rowData["Open time"]).getTime();
            const hourValue = Math.floor(timestamp / 1000 / 3600) * 3600;
            const closingPrice = parseFloat(rowData.Close);
            tokenPriceHistoryBTC.set(hourValue, closingPrice);
          })
          .on("end", () => {
            console.log(`Loaded ${tokenPriceHistoryBTC.size} BTC prices`);

            // Load BYBIT_ETHUSDT_1h
            fs.createReadStream(bybitEthFile)
              .pipe(fastCsv.parse({ headers: true, trim: true }))
              .on("data", (rowData) => {
                try {
                  const timestamp = new Date(rowData.Datetime).getTime();
                  const hourValue = Math.floor(timestamp / 1000 / 3600) * 3600;
                  const closePrice = parseFloat(rowData.Close);
                  tokenPriceHistoryETH_1h.set(hourValue, closePrice);
                } catch (e) {
                  console.error("Error processing BYBIT ETH hourly data:", e);
                }
              })
              .on("end", () => {
                console.log(`Loaded ${tokenPriceHistoryETH_1h.size} BYBIT ETH 1h prices`);
                resolve();
              })
              .on("error", reject);
          })
          .on("error", reject);
      })
      .on("error", reject);
  });
}


function retrieveETHPriceFromStorage(timestampValue, ethMinPrice = false) {
  if (ethMinPrice) {
    // Current logic: Try to get exact minute price first
    const exactPrice = tokenPriceHistoryETH.get(timestampValue);
    if (exactPrice !== undefined) return exactPrice;

    // If no exact match, find the closest minute price within 60 seconds
    let closestPrice = null;
    let smallestDiff = Infinity;

    for (const [ts, price] of tokenPriceHistoryETH) {
      const diff = Math.abs(ts - timestampValue);
      if (diff < smallestDiff && diff <= 60) {
        smallestDiff = diff;
        closestPrice = price;
      }
    }

    return closestPrice;
  } else {
    // New logic: Retrieve from 1-hour ETH data
    const dateObj = new Date(timestampValue * 1000);
    dateObj.setUTCMinutes(0, 0, 0); // Floor to the start of the hour
    const hourTimestampValue = Math.floor(dateObj.getTime() / 1000);
    return tokenPriceHistoryETH_1h.get(hourTimestampValue) || null;
  }
}

function retrieveBTCPriceFromStorage(timestampValue) {
  const dateObj = new Date(timestampValue * 1000);
  dateObj.setUTCMinutes(0, 0, 0);
  const hourTimestampValue = Math.floor(dateObj.getTime() / 1000);
  return tokenPriceHistoryBTC.get(hourTimestampValue) || null;
}

function createContractHandler(abiData, contractAddress) {
  try {
    return new blockchainHttpProvider.eth.Contract(abiData, contractAddress);
  } catch (err) {
    logger.error(err);
  }
}

function createWSSContractHandler(abiData, contractAddress) {
  try {
    return new blockchainWsProvider.eth.Contract(abiData, contractAddress);
  } catch (err) {
    logger.error(err);
  }
}

function createPairTokenHandler(abiData, contractAddress) {
  try {
    return new blockchainHttpProvider.eth.Contract(abiData, contractAddress);
  } catch (err) {
    logger.error(err);
  }
}

const referenceTokens = [
  WETH_ADDRESS.toLowerCase(),
  DAI_ADDRESS.toLowerCase(),
  USDT_ADDRESS.toLowerCase(),
  USDC_ADDRESS.toLowerCase(),
  TUSD_ADDRESS.toLowerCase(),
  USDP_ADDRESS.toLowerCase(),
  WBTC_ADDRESS.toLowerCase(),
];

const routerList = [
  UNIVERSAL_ROUTER_V4.toLowerCase(),
  ROUTER2_V2.toLowerCase(),
  SWAP_ROUTER_V3.toLowerCase(),
  UNIVERSAL_ROUTER.toLowerCase(),
  UNIVERSAL_ROUTER_2.toLowerCase(),
  AGGREGATION_ROUTER_V6.toLowerCase(),
  V3_OLD_ROUTER.toLowerCase(),
  ONE_INCH_V5_AGGREGATION_ROUTER.toLowerCase(),
  ONE_INCH_DEPLOYER_4.toLowerCase(),
  Unknown_Router15.toLowerCase(),
  DEBRIDGE_PROXY_FORWARDER.toLowerCase(),
  ONE_INCH_V4.toLowerCase(),
  ZERO_X_EXCHANGE_PROXY_ROUTER.toLowerCase(),
  UNI_BOT_ROUTER.toLowerCase(),
  OKX_DEX_Aggregation_Router.toLowerCase(),
  Seawise_Resolver.toLowerCase(),
  KyberSwap_Meta_Aggregation_Router_V2.toLocaleLowerCase(),
  TransitSwap_V5_Router.toLocaleLowerCase(),
  Sushiswap_Router.toLocaleLowerCase(),
  Banana_Gun_Router.toLocaleLowerCase(),
  Banana_Gun_V2_Router.toLocaleLowerCase(),
  Maestro_Router.toLocaleLowerCase(),
  Maestro_Router_2.toLocaleLowerCase(),
  MEV_Bot_Router.toLocaleLowerCase(),
  Mev_Bot_Router2.toLocaleLowerCase(),
  Mev_Bot_Router3.toLocaleLowerCase(),
  Mev_Bot_Router4.toLocaleLowerCase(),
  Metamask_Swap_Router.toLocaleLowerCase(),
  Paraswap_V5_Augustus_Swapper.toLocaleLowerCase(),
  Cow_Protocol_GPv2Settlement.toLocaleLowerCase(),
  Unknown_Router.toLocaleLowerCase(),
  Unknown_Router2.toLocaleLowerCase(),
  Unknown_Router3.toLocaleLowerCase(),
  Unknown_Router4.toLocaleLowerCase(),
  Unknown_Router5.toLocaleLowerCase(),
  Unknown_Router6.toLocaleLowerCase(),
  Unknown_Router7.toLocaleLowerCase(),
  Unknown_Router8.toLocaleLowerCase(),
  Unknown_Router9.toLocaleLowerCase(),
  Unknown_Router10.toLocaleLowerCase(),
  Unknown_Router11.toLocaleLowerCase(),
  Unknown_Router12.toLocaleLowerCase(),
  Unknown_Router13.toLocaleLowerCase(),
  Unknown_Router14.toLocaleLowerCase(),
];

const transferEventSignatures = [TRANSFER_TOPIC, TRANSFER_FROM_TOPIC];

async function convertHexToAddress(hexData) {
  const decodedResult = blockchainHttpProvider.eth.abi.decodeParameters(
    [{ type: "address", name: "address" }],
    hexData
  );
  return decodedResult.address;
}

async function getUSDPriceForToken(tokenAddress) {
  const API_ENDPOINT = "https://coins.llama.fi/prices/current/";
  let tokenIdentifier;
  if (tokenAddress === "ETH") tokenIdentifier = "coingecko:ethereum";
  else if (tokenAddress === "BTC") tokenIdentifier = "coingecko:bitcoin";
  else tokenIdentifier = `ethereum:${tokenAddress}`;

  try {
    const apiResponse = await axios.get(
      `${API_ENDPOINT}${tokenIdentifier}?searchWidth=6h`,
      {
        headers: {
          "-H": "accept: application/json",
        },
      }
    );

    if (Object.keys(apiResponse.data.coins).length > 0) {
      const priceData = apiResponse.data.coins[tokenIdentifier];
      if (tokenAddress === "ETH") priceData.decimals = 18;
      if (tokenAddress === "BTC") priceData.decimals = 8;
      return priceData;
    } else return 0;
  } catch (err) {
    logger.error(err);
    return 0;
  }
}

async function fetchPriceByDate(coinIdentifier, timestampValue) {
  const dateObj = new Date(timestampValue * 1000);
  const formattedDate = `${dateObj.getDate().toString().padStart(2, "0")}-${(
    dateObj.getMonth() + 1
  )
    .toString()
    .padStart(2, "0")}-${dateObj.getFullYear()}`;

  const apiUrl = `https://api.coingecko.com/api/v3/coins/${coinIdentifier}/history?date=${formattedDate}`;

  try {
    const apiResponse = await axios.get(apiUrl);
    const usdValue = apiResponse.data?.market_data?.current_price?.usd;

    if (!usdValue) {
      throw new Error("Price data not available in response");
    }

    return usdValue;
  } catch (error) {
    console.error(
      `Error fetching ${coinIdentifier} price on ${formattedDate}:`,
      error.message
    );
    return null;
  }
}

async function getETHBalance(walletAddress) {
  try {
    const balanceAmount = await blockchainHttpProvider.eth.getBalance(
      walletAddress
    );
    return balanceAmount;
  } catch (err) {
    logger.error("Error fetching wallet balance:", err.message);
    return 0;
  }
}

async function fetchTokenInfo(contractABI, tokenAddress) {
  try {
    const tokenContract = createContractHandler(contractABI, tokenAddress);

    const tokenSymbol = await tokenContract.methods.symbol().call();
    const tokenName = await tokenContract.methods.name().call();
    const decimalPlaces = await tokenContract.methods.decimals().call();

    let supplyTotal = await tokenContract.methods.totalSupply().call();

    const decimalsValue = parseInt(BigInt(decimalPlaces));
    supplyTotal = parseInt(BigInt(supplyTotal)) / 10 ** decimalsValue;

    return {
      name: tokenName,
      symbol: tokenSymbol,
      dec: decimalsValue,
      totalSupply: supplyTotal,
    };
  } catch (err) {
    const fallbackResult = await fetchTokenInfo(erc20ABI_Bytes32, tokenAddress);
    if (!fallbackResult) return null;
    else return fallbackResult;
  }
}

async function calculateBurnedTokens(tokenContractAddress) {
  try {
    const balanceDead = await getTokenBalance(
      tokenContractAddress,
      "0x000000000000000000000000000000000000dEaD"
    );

    const balanceZero = await getTokenBalance(
      tokenContractAddress,
      "0x0000000000000000000000000000000000000000"
    );

    const totalBurned = balanceDead + balanceZero;
    if (isNaN(totalBurned)) return 0;
    else return totalBurned;
  } catch (err) {
    logger.error(err);
    return 0;
  }
}

async function getTokenBalance(tokenContractAddress, walletAddress) {
  try {
    const tokenInstance = createContractHandler(
      erc20_ABI,
      tokenContractAddress
    );
    if (
      tokenInstance.methods.hasOwnProperty("decimals") &&
      tokenInstance.methods.hasOwnProperty("balanceOf")
    ) {
      let decimalCount = await tokenInstance.methods.decimals().call();
      let balanceAmount = await tokenInstance.methods
        .balanceOf(walletAddress)
        .call();

      const decimalValue = parseInt(BigInt(decimalCount));
      return parseFloat(BigInt(balanceAmount)) / 10 ** decimalValue;
    } else null;
  } catch (err) {
    logger.error(err);
    throw err;
  }
}

function determineTokenPair(tokenAddress1, tokenAddress2) {
  if (referenceTokens.includes(tokenAddress1.toLowerCase())) {
    return {
      quoteToken: tokenAddress1,
      baseToken: tokenAddress2,
    };
  } else {
    return {
      quoteToken: tokenAddress2,
      baseToken: tokenAddress1,
    };
  }
}

async function fetchBlockTime(blockNumberValue) {
  const blockData = await blockchainHttpProvider.eth.getBlock(blockNumberValue);
  return Number(blockData.timestamp);
}

async function retrieveTokenTransfers(
  tokenContractAddress,
  startBlock,
  endBlock
) {
  const transferLogs = await blockchainHttpProvider.eth.getPastLogs({
    address: tokenContractAddress,
    fromBlock: startBlock,
    toBlock: endBlock,
    topics: [
      blockchainHttpProvider.utils.sha3("Transfer(address,address,uint256)"),
    ],
  });

  const transactionMap = new Map();
  transferLogs.forEach((logEntry) => {
    const transactionHash = logEntry.transactionHash;
    if (!transactionMap.has(transactionHash)) {
      transactionMap.set(transactionHash, []);
    }

    transactionMap.get(transactionHash).push({
      from: `0x${logEntry.topics[1].slice(26)}`,
      to: `0x${logEntry.topics[2].slice(26)}`,
      value: blockchainHttpProvider.utils.hexToNumberString(logEntry.data),
      blockNumber: logEntry.blockNumber,
    });
  });

  const transactionList = Array.from(transactionMap.entries()).map(
    ([txHash, transferData]) => ({
      txHash,
      blockNumber: transferData[0].blockNumber,
      from: transferData[0].from,
      to: transferData[0].to,
      transfers: transferData,
    })
  );
  console.log("Unique Transactions:", transactionList.length);
}

async function fetchTokenTransfersFromAPI(
  tokenAddress,
  initialBlock,
  finalBlock
) {
  const apiUrl = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${tokenAddress}&startblock=${initialBlock}&endblock=${finalBlock}&sort=asc&apikey=${process.env.ETHERSCAN_API_KEY}`;
  const apiResponse = await axios.get(apiUrl);

  if (apiResponse.data.status === "1") {
    return apiResponse.data.result.map((txData) => ({
      txHash: txData.hash,
      from: txData.from,
      to: txData.to,
      value: txData.value / 10 ** 18,
      block: txData.blockNumber,
      timestamp: new Date(txData.timeStamp * 1000).toISOString(),
    }));
  } else {
    throw new Error("Etherscan error: " + apiResponse.data.message);
  }
}

async function getBlockTime(blockNumberValue) {
  try {
    const blockInfo = await blockchainHttpProvider.eth.getBlock(
      blockNumberValue
    );
    return blockInfo.timestamp;
  } catch (err) {
    console.error(
      `Error getting block ${blockNumberValue} timestamp:`,
      err.message
    );
    return null;
  }
}

function filterUniqueTransactions(transactionList) {
  const seenHashes = new Set();
  const uniqueTransactions = [];

  for (const tx of transactionList) {
    if (!tx.transactionHash) {
      uniqueTransactions.push(tx.transactionHash);
      continue;
    }
    if (!seenHashes.has(tx.transactionHash)) {
      seenHashes.add(tx.transactionHash);
      uniqueTransactions.push(tx.transactionHash);
    }
  }
  return uniqueTransactions;
}

module.exports = {
  retrieveTokenTransfers,
  fetchBlockTime,
  blockchainHttpProvider,
  blockchainWsProvider,
  referenceTokens,
  transferEventSignatures,
  routerList,
  createContractHandler,
  createWSSContractHandler,
  convertHexToAddress,
  getUSDPriceForToken,
  fetchTokenInfo,
  getETHBalance,
  determineTokenPair,
  calculateBurnedTokens,
  getTokenBalance,
  createPairTokenHandler,
  fetchPriceByDate,
  getBlockTime,
  fetchTokenTransfersFromAPI,
  fetchHistoricalPriceData,
  retrieveHistoricalPriceFromAPI,
  retrieveBTCPriceFromStorage,
  initializeTokenPricesFromFiles,
  retrieveETHPriceFromStorage,
  filterUniqueTransactions,
};
