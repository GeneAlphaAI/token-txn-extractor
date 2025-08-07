// Optimized version: improved readability, removed duplicate code, modularized shared logic
require("dotenv").config();

const {
  blockchainHttpProvider,
  referenceTokens,
  getUSDPriceForToken,
  fetchTokenInfo,
  createPairTokenHandler,
  fetchBlockTime,
  retrieveBTCPriceFromStorage,
  retrieveETHPriceFromStorage,
} = require("../../utils/web3Utils");

const erc20ABI = require("../../resources/ABIs/ERC20_ABI.json");
const v2PollABI = require("../../resources/ABIs/v2-pool-abi.json");

const {
  decodeV3SwapDataHex,
  getWETHTransferLog,
  getTokenTransferLog,
  getUSDTransferLog,
  decodeV2SwapDataHex,
  decodeV2ReservesHex,
  getUSDMultiSwapTransferLog,
  getWBTCTransferLog,
  getPairTokens,
} = require("./web3Helper");

const { deserializeObject } = require("../../utils/appUtils");
const Config = require("../../utils/config");
const logger = require("../../utils/logger");

const { UNISWAP_V2_SWAP_TOPIC, UNISWAP_V3_SWAP_TOPIC, WETH_ADDRESS } =
  process.env;

function getTypeOfV3Transaction(primaryAmount, swappedAmount) {
  return primaryAmount === swappedAmount ? "SELL" : "BUY";
}

function getTypeOfV2Transaction(primaryAmount, swappedAmount) {
  return primaryAmount === swappedAmount ? "BUY" : "SELL";
}

async function getPriceWithFallback(token, timestamp, historicalTxns) {
  // Fast path if no historical context is available
  if (!historicalTxns) {
    const currentPrice = await getUSDPriceForToken(token);
    return currentPrice?.price || currentPrice;
  }

  let fallbackPrice;

  // Use stored historical price if timestamp is before cutoff
  if (timestamp <= 1751922000) {
    fallbackPrice =
      token === "ETH"
        ? retrieveETHPriceFromStorage(timestamp)
        : retrieveBTCPriceFromStorage(timestamp);
  }

  // Fallback to live price if no historical price was found
  const priceData = fallbackPrice ?? (await getUSDPriceForToken(token));

  if (typeof priceData === "object" && priceData?.price) {
    return priceData.price;
  }

  return priceData;
  // Fast path if no historical context is available
  if (!historicalTxns) {
    const currentPrice = await getUSDPriceForToken(token);
    return currentPrice?.price || currentPrice;
  }

  let fallbackPrice;

  // Use stored historical price if timestamp is before cutoff
  if (timestamp <= 1751922000) {
    fallbackPrice =
      token === "ETH"
        ? retrieveETHPriceFromStorage(timestamp)
        : retrieveBTCPriceFromStorage(timestamp);
  }

  // Fallback to live price if no historical price was found
  const priceData = fallbackPrice ?? (await getUSDPriceForToken(token));

  if (typeof priceData === "object" && priceData?.price) {
    return priceData.price;
  }

  return priceData;
}

async function fetchReserves(logList, tokenMeta) {
  for (const log of logList) {
    if (
      log.topics?.[0] ===
      "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"
    ) {
      const reserveData = decodeV2ReservesHex(log);
      const pair = createPairTokenHandler(v2PollABI, log.address);
      const [t0, t1] = [
        await pair.methods.token0().call(),
        await pair.methods.token1().call(),
      ].map((a) => a.toLowerCase());
      if (![t0, t1].includes(WETH_ADDRESS.toLowerCase())) continue;

      const [ethRes, tokRes] =
        t0 === WETH_ADDRESS.toLowerCase()
          ? [
              reserveData.reserve0 / 1e18,
              reserveData.reserve1 / 10 ** tokenMeta.dec,
            ]
          : [
              reserveData.reserve1 / 1e18,
              reserveData.reserve0 / 10 ** tokenMeta.dec,
            ];
      return { ethRes, tokRes };
    }
  }
  return {};
}

function toTokenAmount(value, decimals) {
  return value / 10 ** decimals;
}

async function identifyNProcessTxns(txHash, historicalTxns = false) {
  try {
    const receipt = await blockchainHttpProvider.eth.getTransactionReceipt(
      txHash
    );
    // for (const { tx, receipt } of results) {
    if (!receipt.status) return;

    if (
      receipt.logs.length === 1 &&
      receipt.logs[0].topics[0] === Config.TRANSFER_TOPIC &&
      receipt.logs[0].data !== "0x"
    ) {
      // if (
      //   receipt.to &&
      //   Config.BLACK_LISTED_ADDRESSES.includes(receipt.to.toLowerCase())
      // )
      return;
    } else if (receipt.logs.length > 1) {
      // get all the swap logs
      const allSwapLogs = receipt.logs.filter(
        (log) =>
          log.topics[0] === Config.UNISWAP_V2_SWAP_TOPIC ||
          log.topics[0] === Config.UNISWAP_V3_SWAP_TOPIC
      );
      if (allSwapLogs.length === 0) return;
      else if (allSwapLogs.length === 1) {
        const pair = await getPairTokens(allSwapLogs[0].address);
        if (pair.baseToken && pair.quoteToken) {
          return await getTransactionDetails(
            receipt,
            pair,
            allSwapLogs[0],
            historicalTxns
          );
        }
      } else {
        logger.warn(
          `Multiple pools found in transaction receipt: ${allSwapLogs.length}.`
        );

        const swapLogsWithPairs = await Promise.all(
          allSwapLogs.map(async (log) => ({
            log,
            pair: await getPairTokens(log.address),
          }))
        );

        const validPairs = swapLogsWithPairs.filter(
          (item) => item.pair.baseToken && item.pair.quoteToken
        );

        // Process trades
        return await Promise.all(
          validPairs.map(
            (item) =>
              getTransactionDetails(
                receipt,
                item.pair,
                item.log,
                historicalTxns
              ) // Pass specific log
          )
        );
      }
    }
  } catch (error) {
    if (error.code != "CALL_EXCEPTION") {
      console.error(error);
    }
  }
}

async function getTransactionDetails(
  receiptObj,
  pair,
  swapLog,
  historicalTxns
) {
  try {
    const txHash = receiptObj.transactionHash;
    const blockNumber = Number(receiptObj.blockNumber);
    const logList = receiptObj.logs;
    let v2SwapLog, v3SwapLog;
    if (
      swapLog.topics[0] === Config.UNISWAP_V2_SWAP_TOPIC &&
      swapLog.address.toLowerCase() === pair.poolAddress.toLowerCase()
    ) {
      v2SwapLog = swapLog;
    } else if (
      swapLog.topics[0] === Config.UNISWAP_V3_SWAP_TOPIC &&
      swapLog.address.toLowerCase() === pair.poolAddress.toLowerCase()
    ) {
      v3SwapLog = swapLog;
    }

    if (v3SwapLog) {
      const parsed = decodeV3SwapDataHex(v3SwapLog.data);

      const [ethTx, usdTx, timestamp] = await Promise.all([
        getWETHTransferLog(receiptObj, parsed),
        getUSDMultiSwapTransferLog(receiptObj, parsed),
        fetchBlockTime(blockNumber),
      ]);

      const handleSwap = async (
        usdTransfer,
        ethTransfer,
        multiSwap = false
      ) => {
        const tokenTx = await getTokenTransferLog(
          receiptObj,
          parsed,
          multiSwap,
          ethTransfer?.value || usdTransfer.value
        );
        if (!tokenTx.dstLog) return null;

        const [usdMeta, tokenMeta, ethPrice, btcPrice] = await Promise.all([
          fetchTokenInfo(erc20ABI, usdTransfer.dstLog.address),
          fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
          getPriceWithFallback("ETH", timestamp, historicalTxns),
          getPriceWithFallback("BTC", timestamp, historicalTxns),
        ]);

        const usdAmt = toTokenAmount(usdTransfer.value, usdMeta.dec);
        const tokenAmount = toTokenAmount(tokenTx.tokenValue, tokenMeta.dec);
        const ethAmount = ethTransfer
          ? toTokenAmount(ethTransfer.value, 18)
          : 0;
        const reserves = await fetchReserves(logList, tokenMeta);

        return {
          type: getTypeOfV3Transaction(
            usdTransfer.value || ethTransfer.value,
            parsed.amount0
          ),
          txHash: txHash,
          token: tokenTx.dstLog.address,
          name: tokenMeta.name,
          symbol: tokenMeta.symbol,
          decimals: tokenMeta.dec,
          totalSupply: tokenMeta.totalSupply,
          tokenValue: tokenAmount,
          ethAmount: ethAmount || 0,
          usdValue: usdAmt || ethAmount * ethPrice,
          tokenPriceInUsd: (usdAmt || ethAmount * ethPrice) / tokenAmount,
          blockNumber: blockNumber,
          multiSwap: multiSwap,
          ethreserve: reserves.ethRes,
          tokenReserve: reserves.tokRes,
          ethCurrentPrice: ethPrice,
          btcCurrentPrice: btcPrice,
          timestamp: timestamp,
        };
      };

      // weth trades
      if (ethTx.dstLog && !usdTx.dstLog && !usdTx.value)
        return await handleSwap({ value: 0, dstLog: ethTx.dstLog }, ethTx);
      // weth + usd trades
      if (ethTx.dstLog && usdTx.dstLog)
        return await handleSwap(usdTx, ethTx, true);

      const [btcTx, fallbackUsd] = await Promise.all([
        getWBTCTransferLog(receiptObj, parsed),
        getUSDTransferLog(receiptObj, parsed),
      ]);
      // wbtc + usd trades
      if (btcTx.dstLog && usdTx.dstLog)
        return await handleSwap(usdTx, btcTx, true);
      // usd only trades
      if (fallbackUsd.dstLog || fallbackUsd.value)
        return await handleSwap(fallbackUsd, null, true);
    }

    if (v2SwapLog) {
      const parsed = decodeV2SwapDataHex(v2SwapLog);

      const [ethTx, usdTx, timestamp] = await Promise.all([
        getWETHTransferLog(receiptObj, parsed),
        getUSDMultiSwapTransferLog(receiptObj, parsed),
        fetchBlockTime(blockNumber),
      ]);

      const handleSwap = async (
        usdTransfer,
        ethTransfer,
        multiSwap = false
      ) => {
        const tokenTx = await getTokenTransferLog(
          receiptObj,
          parsed,
          multiSwap,
          usdTransfer.value || ethTransfer?.value
        );
        if (!tokenTx.dstLog) return null;

        const [usdMeta, tokenMeta, ethPrice, btcPrice] = await Promise.all([
          fetchTokenInfo(erc20ABI, usdTransfer.dstLog.address),
          fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
          getPriceWithFallback("ETH", timestamp, historicalTxns),
          getPriceWithFallback("BTC", timestamp, historicalTxns),
        ]);

        const usdAmt = toTokenAmount(usdTransfer.value, usdMeta.dec);
        const tokenAmount = toTokenAmount(tokenTx.tokenValue, tokenMeta.dec);
        const ethAmount = ethTransfer
          ? toTokenAmount(ethTransfer.value, 18)
          : 0;
        const reserves = await fetchReserves(logList, tokenMeta);

        return {
          type: getTypeOfV2Transaction(
            usdTransfer.value || ethTransfer.value,
            parsed.amount0
          ),
          txHash: txHash,
          token: tokenTx.dstLog.address,
          name: tokenMeta.name,
          symbol: tokenMeta.symbol,
          decimals: tokenMeta.dec,
          totalSupply: tokenMeta.totalSupply,
          tokenValue: tokenAmount,
          ethAmount: ethAmount || 0,
          usdValue: usdAmt || ethAmount * ethPrice,
          tokenPriceInUsd: (usdAmt || ethAmount * ethPrice) / tokenAmount,
          blockNumber: blockNumber,
          multiSwap: multiSwap,
          ethreserve: reserves.ethRes,
          tokenReserve: reserves.tokRes,
          ethCurrentPrice: ethPrice,
          btcCurrentPrice: btcPrice,
          timestamp: timestamp,
        };
      };

      // weth trades
      if (ethTx.dstLog && !usdTx.dstLog && !usdTx.value)
        return await handleSwap({ value: 0, dstLog: ethTx.dstLog }, ethTx);
      // weth + usd trades
      if (ethTx.dstLog && usdTx.dstLog)
        return await handleSwap(usdTx, ethTx, true);
      const [btcTx, fallbackUsd] = await Promise.all([
        getWBTCTransferLog(receiptObj, parsed),
        getUSDTransferLog(receiptObj, parsed),
      ]);
      // wbtc + usd trades
      if (btcTx.dstLog && usdTx.dstLog)
        return await handleSwap(usdTx, btcTx, true);
      // usd only trades
      if (fallbackUsd.dstLog || fallbackUsd.value)
        return await handleSwap(fallbackUsd, null, true);
    }

    return null;
  } catch (err) {
    console.error("Failed to extract txn details:", err);
    return null;
  }
}

module.exports = {
  getTransactionDetails,
  identifyNProcessTxns,
  getTypeOfV3Transaction,
  getTypeOfV2Transaction,
};
