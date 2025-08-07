// Optimized version: improved readability, removed duplicate code, modularized shared logic
require("dotenv").config();

const {
  blockchainHttpProvider,
  getUSDPriceForToken,
  fetchTokenInfo,
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
  getUSDMultiSwapTransferLog,
  getWBTCTransferLog,
  getPairTokens,
} = require("./web3Helper");

const { deserializeObject } = require("../../utils/appUtils");
const Config = require("../../utils/config");
const logger = require("../../utils/logger");

const { UNISWAP_V2_SWAP_TOPIC, UNISWAP_V3_SWAP_TOPIC, WETH_ADDRESS } =
  process.env;

function getTypeOfWethV3Transaction(primaryAmount, swappedAmount) {
  // return primaryAmount === swappedAmount ? "SELL" : "BUY";

  // if tracking WETH trades, we will reverse the logic
  return primaryAmount === swappedAmount ? "BUY" : "SELL";
}

function getTypeOfWethV2Transaction(primaryAmount, swappedAmount) {
  // return primaryAmount === swappedAmount ? "BUY" : "SELL";

  // if tracking WETH trades, we will reverse the logic
  return primaryAmount === swappedAmount ? "SELL" : "BUY";
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
        ? retrieveETHPriceFromStorage(timestamp,true)
        : retrieveBTCPriceFromStorage(timestamp);
  }

  // Fallback to live price if no historical price was found
  const priceData = fallbackPrice ?? (await getUSDPriceForToken(token));

  if (typeof priceData === "object" && priceData?.price) {
    return priceData.price;
  }

  return priceData;
}

function toTokenAmount(value, decimals) {
  return value / 10 ** decimals;
}

async function identifyNProcessWethTxns(txHash, historicalTxns = false) {
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

        const [usdMeta, ethMeta, ethPrice, btcPrice] = await Promise.all([
          fetchTokenInfo(erc20ABI, usdTransfer?.dstLog?.address),
          fetchTokenInfo(erc20ABI, ethTransfer?.dstLog?.address),
          getPriceWithFallback("ETH", timestamp, historicalTxns),
          getPriceWithFallback("BTC", timestamp, historicalTxns),
        ]);

        const usdAmt = toTokenAmount(usdTransfer.value, usdMeta.dec);
        const ethAmount = ethTransfer
          ? toTokenAmount(ethTransfer.value, 18)
          : 0;

        return {
          type: getTypeOfWethV3Transaction(
            usdTransfer.value || ethTransfer.value,
            parsed.amount0
          ),
          txHash: txHash,
          token: tokenTx.dstLog.address,
          name: ethMeta.name,
          symbol: ethMeta.symbol,
          decimals: ethMeta.dec,
          totalSupply: ethMeta.totalSupply,
          ethAmount: ethAmount || 0,
          usdValue: usdAmt || ethAmount * ethPrice,
          blockNumber: blockNumber,
          multiSwap: multiSwap,
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

        const [usdMeta, ethMeta, ethPrice, btcPrice] = await Promise.all([
          fetchTokenInfo(erc20ABI, usdTransfer?.dstLog?.address),
          fetchTokenInfo(erc20ABI, ethTransfer?.dstLog?.address),
          getPriceWithFallback("ETH", timestamp, historicalTxns),
          getPriceWithFallback("BTC", timestamp, historicalTxns),
        ]);

        const usdAmt = toTokenAmount(usdTransfer.value, usdMeta.dec);
        const ethAmount = ethTransfer
          ? toTokenAmount(ethTransfer.value, 18)
          : 0;

        return {
          type: getTypeOfWethV2Transaction(
            usdTransfer.value || ethTransfer.value,
            parsed.amount0
          ),
          txHash: txHash,
          token: tokenTx.dstLog.address,
          name: ethMeta.name,
          symbol: ethMeta.symbol,
          decimals: ethMeta.dec,
          totalSupply: ethMeta.totalSupply,
          // tokenValue: tokenAmount,
          ethAmount: ethAmount || 0,
          usdValue: usdAmt || ethAmount * ethPrice,
          // tokenPriceInUsd: (usdAmt || ethAmount * ethPrice) / tokenAmount,
          blockNumber: blockNumber,
          multiSwap: multiSwap,
          // ethreserve: reserves.ethRes,
          // tokenReserve: reserves.tokRes,
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
  identifyNProcessWethTxns,
  getTypeOfWethV3Transaction,
  getTypeOfWethV2Transaction,
};
