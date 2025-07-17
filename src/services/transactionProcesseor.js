const { getTransactionDetails } = require("./web3Services/txnDataExtractor");
const {
  fetchBlockTime,
  filterUniqueTransactions,
} = require("../utils/web3Utils");
const { fetchTokenTransfers } = require("./externalAPIs/moralisAPI");

const CONCURRENCY_LIMIT = 80;

/**
 * Builds a comprehensive hourly window analysis from transaction data.
 * 
 * Processes transaction data within a specific time window to calculate:
 * - Buy/sell counts and activity metrics
 * - Token volume (in tokens and USD)
 * - Token price statistics (average, latest, opening)
 * - Market data (ETH/BTC prices)
 * - Block range and transaction metadata
 * 
 * @param {number} windowStart - Unix timestamp (seconds) of the window start
 * @param {Array<Object>} transactions - Array of processed transaction objects
 * @returns {Promise<Object>} - Detailed hourly window analysis object
 * 
 * @example
 * const windowData = await buildHourlyWindow(1625097600, transactions);
 * 
 * Returned object structure:
 * {
 *   hourStartUTC: "2021-06-30 00:00:00",  // Formatted start time
 *   hourEndUTC: "2021-06-30 01:00:00",    // Formatted end time
 *   totalTxns: 15,                        // Total transactions
 *   buyCount: 10,                         // Number of BUY transactions
 *   sellCount: 5,                         // Number of SELL transactions
 *   activeAddressCount: 8,                // Unique active addresses
 *   lastTokenPrice: 0.25,                 // First token price in window
 *   latestTokenPrice: 0.28,               // Last token price in window
 *   avgTokenPrice: 0.26,                  // Average token price
 *   tokenVolume: "1500.00",               // Total token volume
 *   tokenVolumeUSD: "390.00",             // Total USD volume
 *   ethPrice: "1800.50",                  // ETH price at window end
 *   btcPrice: "32000.75",                 // BTC price at window end
 *   startBlock: 123456,                   // First block in window
 *   endBlock: 123468,                     // Last block in window
 *   transactionHashes: "0xabc...",        // Comma-separated tx hashes
 *   multiSwap: "Yes"                      // Whether multi-swaps occurred
 * }
 */
const buildHourlyWindow = async (windowStart, transactions) => {
  const windowEnd = windowStart + 3600;
  const buySellTxns = transactions.filter(
    (t) => t.type === "BUY" || t.type === "SELL"
  );

  const buyCount = buySellTxns.filter((t) => t.type === "BUY").length;
  const sellCount = buySellTxns.filter((t) => t.type === "SELL").length;

  const tokenVolume = buySellTxns.reduce(
    (acc, t) => acc + (t.tokenValue || 0),
    0
  );
  const tokenVolumeUSD = buySellTxns.reduce(
    (acc, t) => acc + (t.usdValue || 0),
    0
  );

  let ethPrice = buySellTxns.length
    ? buySellTxns[buySellTxns.length - 1].ethCurrentPrice || 0
    : 0;
  let btcPrice = buySellTxns.length
    ? buySellTxns[buySellTxns.length - 1].btcCurrentPrice || 0
    : 0;

  // Calculate token prices for each transaction
  const tokenPrices = await Promise.all(
    buySellTxns.map(async (t) => {
      // Calculate price from reserves if available
      if (t?.ethreserve && t?.tokenReserve && ethPrice) {
        return (t.ethreserve * ethPrice) / t.tokenReserve;
      }

      if (t.tokenPriceInUsd) {
        return t.tokenPriceInUsd;
      }

      // Fallback to usdValue/tokenValue if available
      if (t.usdValue && t.tokenValue) {
        return t.usdValue / t.tokenValue;
      }

      return 0;
    })
  );

  // Calculate average token price in this window
  const avgPrice = tokenPrices.length
    ? tokenPrices.reduce((a, b) => a + b, 0) / tokenPrices.length
    : 0;

  // Get the latest token price from the last transaction in this window
  const latestPrice = tokenPrices.length
    ? tokenPrices[tokenPrices.length - 1]
    : 0;

  const formatDateTime = (ts) =>
    new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);

  return {
    hourStartUTC: formatDateTime(windowStart),
    hourEndUTC: formatDateTime(windowEnd),
    totalTxns: transactions.length,
    buyCount,
    sellCount,
    activeAddressCount: buyCount + sellCount,
    lastTokenPrice: tokenPrices[0] || 0,
    latestTokenPrice: latestPrice,
    avgTokenPrice: avgPrice,
    tokenVolume: tokenVolume.toFixed(2),
    tokenVolumeUSD: tokenVolumeUSD.toFixed(2),
    ethPrice: ethPrice?.toFixed(2) || "N/A",
    btcPrice: btcPrice?.toFixed(2) || "N/A",
    startBlock: Math.min(...transactions.map((t) => t.blockNumber)),
    endBlock: Math.max(...transactions.map((t) => t.blockNumber)),
    transactionHashes: transactions.map((t) => t.txHash).join(", "),
    multiSwap: transactions.some((t) => t.multiSwap) ? "Yes" : "No",
  };
};

/**
 * Executes asynchronous tasks with controlled concurrency.
 * 
 * Processes an array of items through an async function while maintaining
 * a maximum number of concurrent operations. Automatically handles:
 * - Concurrency limiting
 * - Order-preserving results
 * - Null filtering
 * - Error isolation (individual failures won't stop other operations)
 * 
 * @param {Array} items - Input items to process
 * @param {number} limit - Maximum concurrent operations
 * @param {Function} asyncFn - Async processing function (item) => Promise<result>
 * @returns {Promise<Array>} - Resolves to array of successful results (may be shorter than input)
 * 
 * @example
 * const results = await runWithConcurrency(
 *   [1, 2, 3, 4],
 *   2,
 *   async (num) => await processNumber(num)
 * );
 * 
 * Key characteristics:
 * - Maintains input order in output array
 * - Filters out null/undefined results
 * - Uses recursive promise chaining for efficient concurrency
 * - Automatically scales workers to min(limit, items.length)
 */
const runWithConcurrency = async (items, limit, asyncFn) => {
  const results = [];
  let idx = 0;
  const runNext = async () => {
    if (idx >= items.length) return;
    const current = idx++;
    results[current] = await asyncFn(items[current]);
    await runNext();
  };
  const workers = Array(Math.min(limit, items.length)).fill(null).map(runNext);
  await Promise.all(workers);
  return results.filter(Boolean);
};

/**
 * Processes token transactions to generate hourly window data for analysis.
 * 
 * This function:
 * 1. Fetches all transactions for a given token address
 * 2. Cleans and filters the transactions
 * 3. Gathers detailed information for each transaction
 * 4. Analyzes transactions within a 1-hour window (either most recent hour or last active hour)
 * 5. Returns formatted window data for analysis
 * 
 * @param {string} tokenAddress - The Ethereum address of the token to process
 * @returns {Promise<Array<Object>>} - Returns a promise that resolves to an array containing 
 *                                    a single hourly window data object (or empty array if no valid transactions)
 * @throws {Error} - Throws any errors encountered during processing
 * 
 * @example
 * const tokenAddress = '0x123...abc';
 * try {
 *   const windowData = await processTransactions(tokenAddress);
 *   console.log(windowData);
 * } catch (err) {
 *   console.error('Processing failed:', err);
 * }
 * 
 * The returned window data object contains:
 * - windowStart: Timestamp of window start (seconds)
 * - windowEnd: Timestamp of window end (seconds)
 * - transactionCount: Number of transactions in window
 * - transactionDetails: Array of processed transaction objects
 * - (plus any additional metrics added by buildHourlyWindow)
 */
async function processTransactions(tokenAddress) {
  try {
    const tokenTxns = await fetchTokenTransfers(tokenAddress, 4);
    console.log(
      `Fetched ${tokenTxns.length} transactions for token: ${tokenAddress}`
    );
    const cleandTxns = filterUniqueTransactions(tokenTxns);
    console.log(`Cleaned transactions, remaining: ${cleandTxns.length}`);

    if (cleandTxns.length === 0) {
      return [];
    }

    const txDetailsList = await runWithConcurrency(
      cleandTxns,
      CONCURRENCY_LIMIT,
      async (txHash) => {
        const txDetails = await getTransactionDetails(txHash);
        if (!txDetails || typeof txDetails.blockNumber === "undefined") {
          console.log(`Skipping ${txHash} - missing details`);
          return null;
        }

        const timestamp = await fetchBlockTime(Number(txDetails.blockNumber));
        if (!timestamp) {
          console.log(`Skipping ${txHash} - missing timestamp`);
          return null;
        }

        txDetails.timestamp = Number(timestamp);

        console.log(`Processed: ${txHash} (${txDetails.type})`);
        return txDetails;
      }
    );

    // Filter valid transactions and sort by timestamp
    const validTxDetails = txDetailsList
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (validTxDetails.length === 0) return [];

    // Get current time and most recent transaction time
    const currentTime = Math.floor(Date.now() / 1000);

    const mostRecentTxTime =
      validTxDetails[validTxDetails.length - 1].timestamp;

    // Determine the 1-hour window to analyze
    let windowStart;
    const oneHourAgo = currentTime - 3600;

    if (validTxDetails.some((tx) => tx.timestamp >= oneHourAgo)) {
      // Use last hour window if recent transactions exist
      windowStart = oneHourAgo;
    } else {
      // Otherwise use 1 hour before most recent transaction
      windowStart = mostRecentTxTime - 3600;
    }

    // Filter transactions in our target window
    const windowTransactions = validTxDetails.filter(
      (tx) => tx.timestamp >= windowStart && tx.timestamp <= windowStart + 3600
    );

    // Build and return single window data
    if (windowTransactions.length > 0) {
      const windowData = await buildHourlyWindow(
        windowStart,
        windowTransactions
      );
      console.log(`Token Hourly Window Data Generated Successfully`);
      return [windowData]; // Return as array with single window
    }

    return [];
  } catch (err) {
    throw err;
  }
}

module.exports = { processTransactions };
