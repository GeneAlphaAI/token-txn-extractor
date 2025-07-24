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
} = require("./web3Helper");

const { deserializeObject } = require("../../utils/appUtils");

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

async function getTransactionDetails(txHash, historicalTxns = false) {
  try {
    const receipt = await blockchainHttpProvider.eth.getTransactionReceipt(
      txHash
    );
    if (!receipt || !receipt.status || !receipt.logs || !receipt.to)
      return null;

    const receiptObj = deserializeObject(receipt);
    const logList = receiptObj.logs;
    const blockNumber = Number(receiptObj.blockNumber);

    for (const entry of logList) {
      const primaryTopic = entry.topics?.[0];

      if (primaryTopic === UNISWAP_V3_SWAP_TOPIC) {
        const parsed = decodeV3SwapDataHex(entry.data);
        const wethTx = await getWETHTransferLog(receiptObj, parsed);

        if (wethTx.dstLog) {
          const tokenTx = await getTokenTransferLog(
            receiptObj,
            parsed,
            false,
            wethTx.value
          );
          if (
            referenceTokens.includes(wethTx.dstLog.address.toLowerCase()) &&
            referenceTokens.includes(tokenTx.dstLog?.address?.toLowerCase())
          )
            continue;

          const txKind = getTypeOfV3Transaction(
            wethTx.value,
            parsed.negativeValue
          );
          const timestamp = await fetchBlockTime(blockNumber);
          const [meta, ethPrice, btcPrice] = await Promise.all([
            fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
            getPriceWithFallback("ETH", timestamp, historicalTxns),
            getPriceWithFallback("BTC", timestamp, historicalTxns),
          ]);

          const tokenAmount = toTokenAmount(tokenTx.tokenValue, meta.dec);
          const ethAmount = toTokenAmount(wethTx.value, 18);
          const usdValue = ethAmount * ethPrice || ethPrice;

          return {
            type: txKind,
            txHash,
            token: tokenTx.dstLog.address,
            name: meta.name,
            symbol: meta.symbol,
            decimals: meta.dec,
            totalSupply: meta.totalSupply,
            tokenValue: tokenAmount,
            ethAmount,
            usdValue,
            tokenPriceInUsd: usdValue / tokenAmount,
            blockNumber,
            multiSwap: false,
            ethCurrentPrice: ethPrice,
            btcCurrentPrice: btcPrice,
            timestamp,
          };
        }

        const usdTx = await getUSDTransferLog(receiptObj, parsed);
        const tokenTx = await getTokenTransferLog(
          receiptObj,
          parsed,
          true,
          usdTx.value
        );
        if (!tokenTx.dstLog) continue;

        const txKind = getTypeOfV3Transaction(
          usdTx.value,
          parsed.negativeValue
        );
        const timestamp = await fetchBlockTime(blockNumber);
        const [usdMeta, tokenMeta] = await Promise.all([
          fetchTokenInfo(erc20ABI, usdTx.dstLog.address),
          fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
        ]);

        const usdAmt = toTokenAmount(usdTx.value, usdMeta.dec);
        const tokenAmount = toTokenAmount(tokenTx.tokenValue, tokenMeta.dec);

        return {
          type: txKind,
          txHash,
          token: tokenTx.dstLog.address,
          name: tokenMeta.name,
          symbol: tokenMeta.symbol,
          decimals: tokenMeta.dec,
          totalSupply: tokenMeta.totalSupply,
          tokenValue: tokenAmount,
          ethAmount: 0,
          usdValue: usdAmt,
          blockNumber,
          tokenPriceInUsd: usdAmt / tokenAmount,
          multiSwap: false,
          ethCurrentPrice: 0,
          btcCurrentPrice: 0,
          timestamp,
        };
      }

      if (primaryTopic === UNISWAP_V2_SWAP_TOPIC) {
        const parsed = decodeV2SwapDataHex(entry);
        const ethTx = await getWETHTransferLog(receiptObj, parsed);
        const usdTx = await getUSDMultiSwapTransferLog(receiptObj, parsed);
        const fallbackUsd = await getUSDTransferLog(receiptObj, parsed);
        const timestamp = await fetchBlockTime(blockNumber);

        const handleSwap = async (
          usdTransfer,
          ethTransfer,
          multiSwap = false
        ) => {
          const tokenTx = await getTokenTransferLog(
            receiptObj,
            parsed,
            true,
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
            txHash,
            token: tokenTx.dstLog.address,
            name: tokenMeta.name,
            symbol: tokenMeta.symbol,
            decimals: tokenMeta.dec,
            totalSupply: tokenMeta.totalSupply,
            tokenValue: tokenAmount,
            ethAmount,
            usdValue: usdAmt || ethAmount * ethPrice,
            tokenPriceInUsd: (usdAmt || ethAmount * ethPrice) / tokenAmount,
            blockNumber,
            multiSwap,
            ethreserve: reserves.ethRes,
            tokenReserve: reserves.tokRes,
            ethCurrentPrice: ethPrice,
            btcCurrentPrice: btcPrice,
            timestamp,
          };
        };

        if (ethTx.dstLog && !usdTx.dstLog && !usdTx.value)
          return await handleSwap({ value: 0, dstLog: ethTx.dstLog }, ethTx);
        if (ethTx.dstLog && usdTx.dstLog)
          return await handleSwap(usdTx, ethTx, true);
        if (fallbackUsd.dstLog || fallbackUsd.value)
          return await handleSwap(fallbackUsd, null);
      }
    }
    return null;
  } catch (err) {
    console.error("Failed to extract txn details:", err);
    return null;
  }
}

module.exports = {
  getTransactionDetails,
  getTypeOfV3Transaction,
  getTypeOfV2Transaction,
};
