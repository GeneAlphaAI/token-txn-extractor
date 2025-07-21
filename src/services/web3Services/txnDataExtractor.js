require("dotenv").config();

const {
  blockchainHttpProvider,
  referenceTokens,
  getUSDPriceForToken,
  routerAddresses,
  fetchTokenInfo,
  createPairTokenHandler,
  getHistoricalPriceFromTimestamp,
  fetchBlockTime,
  getTokenTransfersWeb3,
  getTokenTransfersEthAPI,
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

const { UNISWAP_V2_SWAP_TOPIC, UNISWAP_V3_SWAP_TOPIC } = process.env;

async function getTransactionDetails(txHash) {
  try {
    const receipt = await blockchainHttpProvider.eth.getTransactionReceipt(
      txHash
    );
    if (!receipt || !receipt.status || !receipt.logs || !receipt.to) {
      console.log("Invalid or failed transaction.");
      return null;
    }

    const receiptObj = deserializeObject(receipt);
    const logList = receiptObj.logs;
    console.log(`logs: ${logList.length} for tx: ${txHash}`);

    for (const entry of logList) {
      const primaryTopic = entry.topics?.[0];

      // Uniswap V3
      if (primaryTopic === UNISWAP_V3_SWAP_TOPIC) {
        const parsedV3Data = decodeV3SwapDataHex(entry.data);
        const wethTx = await getWETHTransferLog(receiptObj, parsedV3Data);

        if (wethTx.dstLog) {
          const tokenTx = await getTokenTransferLog(
            receiptObj,
            parsedV3Data,
            false,
            wethTx.value
          );

          const txKind = getTypeOfV3Transaction(
            wethTx.value,
            parsedV3Data.negativeValue
          );

          const quoteCheck =
            referenceTokens.includes(wethTx.dstLog.address.toLowerCase()) &&
            referenceTokens.includes(tokenTx.dstLog?.address?.toLowerCase());

          if (quoteCheck) continue;

          const [meta, ethPrice, btcPrice] = await Promise.all([
            fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
            getUSDPriceForToken("ETH"),
            getUSDPriceForToken("BTC"),
          ]);

          return {
            type: txKind,
            txHash,
            token: tokenTx.dstLog.address,
            name: meta.name,
            symbol: meta.symbol,
            decimals: meta.dec,
            totalSupply: meta.totalSupply,
            tokenValue: tokenTx.tokenValue / 10 ** meta.dec,
            ethAmount: wethTx.value / 10 ** 18,
            usdValue: (wethTx.value / 10 ** 18) * ethPrice.price,
            tokenPriceInUsd:
              ((wethTx.value / 10 ** 18) * ethPrice.price) /
              (tokenTx.tokenValue / 10 ** meta.dec),
            blockNumber: receiptObj.blockNumber,
            multiSwap: false,
            ethCurrentPrice: ethPrice.price,
            btcCurrentPrice: btcPrice.price,
          };
        }

        const usdTx = await getUSDTransferLog(receiptObj, parsedV3Data);
        const txKind = getTypeOfV3Transaction(
          usdTx.value,
          parsedV3Data.negativeValue
        );
        const tokenTx = await getTokenTransferLog(
          receiptObj,
          parsedV3Data,
          true,
          usdTx.value
        );

        if (!tokenTx.dstLog) continue;

        const [usdMeta, tokenMeta] = await Promise.all([
          fetchTokenInfo(erc20ABI, usdTx.dstLog.address),
          fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
        ]);

        const usdAmt = usdTx.value / 10 ** usdMeta.dec;

        return {
          type: txKind,
          txHash,
          token: tokenTx.dstLog.address,
          name: tokenMeta.name,
          symbol: tokenMeta.symbol,
          decimals: tokenMeta.dec,
          totalSupply: tokenMeta.totalSupply,
          tokenValue: tokenTx.tokenValue / 10 ** tokenMeta.dec,
          ethAmount: 0,
          usdValue: usdAmt,
          blockNumber: receiptObj.blockNumber,
          tokenPriceInUsd: usdAmt / (tokenTx.tokenValue / 10 ** tokenMeta.dec),
          multiSwap: false,
          ethCurrentPrice: null,
        };
      }

      // Uniswap V2
      else if (primaryTopic === UNISWAP_V2_SWAP_TOPIC) {
        const parsedV2Data = decodeV2SwapDataHex(entry);
        const ethTx = await getWETHTransferLog(receiptObj, parsedV2Data);
        const usdTx = await getUSDMultiSwapTransferLog(
          receiptObj,
          parsedV2Data
        );

        if (ethTx.dstLog && !usdTx.dstLog && !usdTx.value) {
          const tokenTx = await getTokenTransferLog(
            receiptObj,
            parsedV2Data,
            false,
            ethTx.value
          );

          const txKind = getTypeOfV2Transaction(
            ethTx.value,
            parsedV2Data.amount0
          );

          if (
            referenceTokens.includes(ethTx?.dstLog?.address?.toLowerCase()) &&
            referenceTokens.includes(tokenTx?.dstLog?.address?.toLowerCase())
          ) {
            continue;
          }

          const [tokenMeta, ethUsd, btcUsd] = await Promise.all([
            fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
            getUSDPriceForToken("ETH"),
            getUSDPriceForToken("BTC"),
          ]);

          let ethRes, tokRes;

          for (const reserveLog of logList) {
            if (
              reserveLog.topics?.[0] ===
              "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"
            ) {
              const reserveData = decodeV2ReservesHex(reserveLog);
              const pair = createPairTokenHandler(
                v2PollABI,
                reserveLog.address
              );
              const t0 = (await pair.methods.token0().call()).toLowerCase();
              const t1 = (await pair.methods.token1().call()).toLowerCase();
              const mainWeth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

              if (!(t0 === mainWeth || t1 === mainWeth)) {
                console.log("Skipping non-ETH pair");
                continue;
              }

              if (t0 === mainWeth) {
                ethRes = reserveData.reserve0 / 10 ** 18;
                tokRes = reserveData.reserve1 / 10 ** tokenMeta.dec;
              } else {
                ethRes = reserveData.reserve1 / 10 ** 18;
                if (ethRes >= 1e4) {
                  ethRes = reserveData.reserve0 / 10 ** 18;
                  tokRes = reserveData.reserve1 / 10 ** tokenMeta.dec;
                }
                tokRes = reserveData.reserve0 / 10 ** tokenMeta.dec;
              }

              break;
            }
          }

          return {
            type: txKind,
            txHash,
            token: tokenTx.dstLog.address,
            name: tokenMeta.name,
            symbol: tokenMeta.symbol,
            decimals: tokenMeta.dec,
            totalSupply: tokenMeta.totalSupply,
            tokenValue: tokenTx.tokenValue / 10 ** tokenMeta.dec,
            ethAmount: ethTx.value / 10 ** 18,
            usdValue: (ethTx.value / 10 ** 18) * ethUsd.price,
            tokenPriceInUsd:
              ((ethTx.value / 10 ** 18) * ethUsd.price) /
              (tokenTx.tokenValue / 10 ** tokenMeta.dec),
            blockNumber: receiptObj.blockNumber,
            multiSwap: false,
            ethreserve: ethRes,
            tokenReserve: tokRes,
            ethCurrentPrice: ethUsd.price,
            btcCurrentPrice: btcUsd.price,
          };
        }

        if (ethTx.dstLog && usdTx.dstLog) {
          console.log("Finding USD Multi swap Transfer Log...");

          const tokenTx = await getTokenTransferLog(
            receiptObj,
            parsedV2Data,
            true,
            ethTx.value
          );

          const txKind = getTypeOfV2Transaction(
            ethTx.value,
            parsedV2Data.amount0
          );

          if (!tokenTx.dstLog) continue;

          const [usdMeta, tokenMeta, ethUsd, btcUsd] = await Promise.all([
            fetchTokenInfo(erc20ABI, usdTx.dstLog.address),
            fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
            getUSDPriceForToken("ETH"),
            getUSDPriceForToken("BTC"),
          ]);

          const usdAmt = usdTx.value / 10 ** usdMeta.dec;
          let ethRes, tokRes;

          for (const reserveLog of logList) {
            if (
              reserveLog.topics?.[0] ===
              "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"
            ) {
              const reserveData = decodeV2ReservesHex(reserveLog);
              const pair = createPairTokenHandler(
                v2PollABI,
                reserveLog.address
              );
              const t0 = (await pair.methods.token0().call()).toLowerCase();
              const t1 = (await pair.methods.token1().call()).toLowerCase();
              const mainWeth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

              if (!(t0 === mainWeth || t1 === mainWeth)) {
                console.log("Skipping non-ETH pair");
                continue;
              }

              if (t0 === mainWeth) {
                ethRes = reserveData.reserve0 / 10 ** 18;
                tokRes = reserveData.reserve1 / 10 ** tokenMeta.dec;
              } else {
                ethRes = reserveData.reserve1 / 10 ** 18;
                if (ethRes >= 1e4) {
                  ethRes = reserveData.reserve0 / 10 ** 18;
                  tokRes = reserveData.reserve1 / 10 ** tokenMeta.dec;
                }
                tokRes = reserveData.reserve0 / 10 ** tokenMeta.dec;
              }
            }
          }

          return {
            type: txKind,
            txHash,
            primaryToken: usdTx.dstLog.address,
            primaryTokenETHAmount: 0,
            primaryTokenInUSD: usdAmt,
            token: tokenTx.dstLog.address,
            name: tokenMeta.name,
            symbol: tokenMeta.symbol,
            decimals: tokenMeta.dec,
            totalSupply: tokenMeta.totalSupply,
            tokenValue: tokenTx.tokenValue / 10 ** tokenMeta.dec,
            ethAmount: ethTx.value / 10 ** 18,
            usdValue: usdAmt,
            tokenPriceInUsd:
              usdAmt / (tokenTx.tokenValue / 10 ** tokenMeta.dec),
            blockNumber: receiptObj.blockNumber,
            multiSwap: true,
            ethreserve: ethRes,
            tokenReserve: tokRes,
            ethCurrentPrice: ethUsd.price,
            btcCurrentPrice: btcUsd.price,
          };
        }

        console.log("Finding USD Transfer Log...");
        const fallbackUsd = await getUSDTransferLog(receiptObj, parsedV2Data);
        if (!fallbackUsd.dstLog && !fallbackUsd.value) continue;

        const tokenTx = await getTokenTransferLog(
          receiptObj,
          parsedV2Data,
          true,
          fallbackUsd.value
        );

        const txKind = getTypeOfV2Transaction(
          fallbackUsd.value,
          parsedV2Data.amount0
        );

        if (!tokenTx.dstLog) continue;

        const [usdMeta, tokenMeta] = await Promise.all([
          fetchTokenInfo(erc20ABI, fallbackUsd.dstLog.address),
          fetchTokenInfo(erc20ABI, tokenTx.dstLog.address),
        ]);

        const usdAmt = fallbackUsd.value / 10 ** usdMeta.dec;

        return {
          type: txKind,
          txHash,
          primaryToken: fallbackUsd.dstLog.address,
          primaryTokenETHAmount: 0,
          primaryTokenInUSD: usdAmt,
          token: tokenTx.dstLog.address,
          name: tokenMeta.name,
          symbol: tokenMeta.symbol,
          decimals: tokenMeta.dec,
          totalSupply: tokenMeta.totalSupply,
          tokenValue: tokenTx.tokenValue / 10 ** tokenMeta.dec,
          ethAmount: 0,
          usdValue: usdAmt,
          tokenPriceInUsd: usdAmt / (tokenTx.tokenValue / 10 ** tokenMeta.dec),
          blockNumber: receiptObj.blockNumber,
          multiSwap: false,
          ethreserve: ethreserve,
          tokenReserve: tokenReserve,
          ethCurrentPrice: usdPrice.price,
        };
      }
    }

    return null;
  } catch (err) {
    console.error("Failed to extract txn details:", err);
    return null;
  }
}

function getTypeOfV3Transaction(primaryAmount, swappedAmount) {
  return primaryAmount === swappedAmount ? "SELL" : "BUY";
}

function getTypeOfV2Transaction(primaryAmount, swappedAmount) {
  return primaryAmount === swappedAmount ? "BUY" : "SELL";
}

module.exports = {
  getTransactionDetails,
  getTypeOfV3Transaction,
  getTypeOfV2Transaction,
};
