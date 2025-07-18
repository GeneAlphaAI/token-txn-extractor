const { getTransactionDetails } = require("./web3Services/txnDataExtractor");
const {
  fetchBlockTime,
  filterUniqueTransactions,
} = require("../utils/web3Utils");
const {
  fetchTokenTransfers,
  fetchTokenTransfersByDate,
} = require("./externalAPIs/moralisAPI");

class TransactionProcessor {
  static CONCURRENCY_LIMIT = 70;

  constructor() {}

  /**
   * Builds a comprehensive hourly window analysis from transaction data
   */
  async buildHourlyWindow(windowStart, transactions) {
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

    const tokenPrices = await Promise.all(
      buySellTxns.map(async (t) => {
        if (t?.ethreserve && t?.tokenReserve && ethPrice) {
          return (t.ethreserve * ethPrice) / t.tokenReserve;
        }
        if (t.tokenPriceInUsd) {
          return t.tokenPriceInUsd;
        }
        if (t.usdValue && t.tokenValue) {
          return t.usdValue / t.tokenValue;
        }
        return 0;
      })
    );

    const avgPrice = tokenPrices.length
      ? tokenPrices.reduce((a, b) => a + b, 0) / tokenPrices.length
      : 0;
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
  }

  /**
   * Executes asynchronous tasks with controlled concurrency
   */
  async runWithConcurrency(items, limit, asyncFn) {
    const results = [];
    let idx = 0;
    const runNext = async () => {
      if (idx >= items.length) return;
      const current = idx++;
      results[current] = await asyncFn(items[current]);
      await runNext();
    };
    const workers = Array(Math.min(limit, items.length))
      .fill(null)
      .map(runNext);
    await Promise.all(workers);
    return results.filter(Boolean);
  }

  /**
   * Processes token transactions to generate hourly window data for analysis
   */
  async generateTokenHourlyData(tokenAddress) {
    try {
      console.log(
        `[Init] Starting analysis for ${tokenAddress.slice(0, 8)}...`
      );

      // Step 1: Fetch all possible recent transactions
      console.log(`[Batch] Beginning transaction collection...`);
      const allTxns = await this.fetchAllRecentTransactions(tokenAddress);
      console.log(`[Batch] Total unique transactions: ${allTxns.length}`);

      // Step 2: Get timestamps for all transactions
      console.log(
        `[Details] Processing ${allTxns.length} transactions with ${TransactionProcessor.CONCURRENCY_LIMIT} concurrency...`
      );
      const txDetailsList = await this.runWithConcurrency(
        allTxns,
        TransactionProcessor.CONCURRENCY_LIMIT,
        async (txHash) => {
          try {
            const txDetails = await getTransactionDetails(txHash);

            // TODO handle v3 txns & usd based txns
            if (!txDetails?.blockNumber) {
              console.log(
                `[Details] Skipping ${txHash.slice(0, 8)} (missing details)`
              );
              return null;
            }

            const timestamp = await fetchBlockTime(
              Number(txDetails.blockNumber)
            );
            if (!timestamp) {
              console.log(
                `[Details] Skipping ${txHash.slice(0, 8)} (no timestamp)`
              );
              return null;
            }

            txDetails.timestamp = Number(timestamp);
            return txDetails;
          } catch (error) {
            console.log(
              `[Details] Failed ${txHash.slice(0, 8)}: ${error.message}`
            );
            return null;
          }
        }
      );

      const validTxDetails = txDetailsList.filter(Boolean);
      console.log(
        `[Validation] ${validTxDetails.length} valid transactions with timestamps`
      );

      if (validTxDetails.length === 0) {
        console.log(`[Result] No valid transactions to analyze`);
        return [];
      }

      // Step 3: Determine the correct 1-hour window
      const currentTime = Math.floor(Date.now() / 1000);
      const oneHourAgo = currentTime - 3600;

      const hasRecentTx = validTxDetails.some(
        (tx) => tx.timestamp >= oneHourAgo
      );
      console.log(`[Window] Recent transactions found: ${hasRecentTx}`);

      let windowStart;
      if (hasRecentTx) {
        windowStart = oneHourAgo;
        console.log(
          `[Window] Using last hour window (${new Date(
            windowStart * 1000
          ).toISOString()})`
        );
      } else {
        const mostRecentTx = validTxDetails.reduce((latest, tx) =>
          tx.timestamp > latest.timestamp ? tx : latest
        );
        windowStart = mostRecentTx.timestamp - 3600;
        console.log(
          `[Window] Using historical window around ${new Date(
            mostRecentTx.timestamp * 1000
          ).toISOString()}`
        );
      }

      // Step 4: Filter transactions in the target window
      const windowTransactions = validTxDetails.filter(
        (tx) =>
          tx.timestamp >= windowStart && tx.timestamp <= windowStart + 3600
      );
      console.log(
        `[Window] Found ${windowTransactions.length} transactions in target window`
      );

      if (windowTransactions.length > 0) {
        const windowData = await this.buildHourlyWindow(
          windowStart,
          windowTransactions
        );
        console.log(`[Result] Successfully built hourly window`);
        return [windowData];
      }

      console.log(`[Result] No transactions in selected window`);
      return [];
    } catch (err) {
      console.error(`[CRASH] Analysis failed:`, err);
      throw err;
    }
  }

  /**
   * Checks if the most recent transaction is within the last hour
   */
  async checkMostRecentTxn(lastTxnInTheBatch) {
    const timestamp = Math.floor(
      new Date(lastTxnInTheBatch?.blockTimestamp).getTime() / 1000
    );
    if (!timestamp) {
      console.log(
        `[Recency] No timestamp for block ${lastTxnInTheBatch.blockNumber}`
      );
      return { hasRecent: false, lastTimestamp: null };
    }

    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const isRecent = timestamp >= oneHourAgo;
    console.log(
      `[Recency] Last tx ${isRecent ? "IS" : "NOT"} recent (${new Date(
        timestamp * 1000
      ).toISOString()})`
    );

    return { hasRecent: isRecent, lastTimestamp: timestamp };
  }

  /**
   * Fetches all recent transactions for a token address
   */
  async fetchAllRecentTransactions(tokenAddress, maxBatches = 5) {
    let allTxns = [];
    let currentBatch = 1;
    let shouldFetchMore = true;

    while (shouldFetchMore && currentBatch <= maxBatches) {
      console.log(`[Batch] Fetching batch ${currentBatch}/${maxBatches}...`);
      const batchTxns = await fetchTokenTransfers(tokenAddress, currentBatch);
      const cleandTxns = filterUniqueTransactions(batchTxns);
      console.log(
        `[Batch] Batch ${currentBatch}: ${cleandTxns.length} new transactions`
      );

      allTxns = [...allTxns, ...cleandTxns];
      const { hasRecent } = await this.checkMostRecentTxn(
        batchTxns[batchTxns.length - 1]
      );

      shouldFetchMore = hasRecent;
      console.log(
        `[Batch] ${hasRecent ? "Continuing" : "Stopping"} collection`
      );
      currentBatch++;
    }

    return allTxns;
  }

  /**
   * Processes historical transactions within a date range
   */
  async generateTokenHistoricalData(tokenAddress, fromDate, toDate) {
    try {
      // Validate date range
      const fromDateObj = new Date(fromDate);
      const toDateObj = new Date(toDate);

      if (isNaN(fromDateObj.getTime())) {
        throw new Error(`Invalid fromDate: ${fromDate}`);
      }
      if (isNaN(toDateObj.getTime())) {
        throw new Error(`Invalid toDate: ${toDate}`);
      }
      if (fromDateObj > toDateObj) {
        throw new Error(`Invalid date range: fromDate cannot be after toDate`);
      }

      console.log(
        `Processing historical data for ${tokenAddress} from ${fromDate} to ${toDate}`
      );

      // Fetch all transactions in the date range
      const tokenTxns = await fetchTokenTransfersByDate(
        tokenAddress,
        fromDate,
        toDate
      );
      const cleanedTxns = filterUniqueTransactions(tokenTxns);
      console.log(`Found ${cleanedTxns.length} unique transactions`);

      if (cleanedTxns.length === 0) {
        return [];
      }

      // Enrich transactions with details
      const txDetailsList = await this.runWithConcurrency(
        cleanedTxns,
        TransactionProcessor.CONCURRENCY_LIMIT,
        async (tx) => {
          try {
            const txDetails = await getTransactionDetails(tx);
            if (!txDetails) {
              console.log(`Skipping ${tx.hash} - missing details`);
              return null;
            }

            const timestamp = await fetchBlockTime(
              Number(txDetails.blockNumber)
            );
            if (!timestamp) {
              console.log(`Skipping ${tx.hash} - missing timestamp`);
              return null;
            }

            return {
              ...txDetails,
              timestamp: Number(timestamp),
              txHash: tx.hash || tx.transaction_hash,
            };
          } catch (error) {
            console.log(`Failed to process ${tx.hash}: ${error.message}`);
            return null;
          }
        }
      );

      // Filter and sort valid transactions
      const validTxDetails = txDetailsList
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (validTxDetails.length === 0) {
        return [];
      }

      // Create hourly windows covering the entire date range
      const hourlyWindows = this.createHourlyWindows(
        validTxDetails,
        Math.floor(fromDateObj.getTime() / 1000),
        Math.floor(toDateObj.getTime() / 1000)
      );

      // Process each window in parallel
      const windowResults = await Promise.all(
        hourlyWindows.map(async ([windowStart, transactions]) => {
          if (transactions.length > 0) {
            return await this.buildHourlyWindow(windowStart, transactions);
          }
          return null;
        })
      );

      return windowResults.filter(Boolean).reverse();
    } catch (err) {
      console.error("Historical processing failed:", err);
      throw err;
    }
  }

  /**
   * Creates hourly windows covering the entire date range
   */
  createHourlyWindows(transactions, fromTimestamp, toTimestamp) {
    const hourlyMap = new Map();

    // Initialize all possible hourly windows in the range
    let currentWindowStart = Math.floor(fromTimestamp / 3600) * 3600;
    const endWindowStart = Math.floor(toTimestamp / 3600) * 3600;

    while (currentWindowStart <= endWindowStart) {
      hourlyMap.set(currentWindowStart, []);
      currentWindowStart += 3600;
    }

    // Assign transactions to their respective hours
    for (const tx of transactions) {
      const windowStart = Math.floor(tx.timestamp / 3600) * 3600;
      if (hourlyMap.has(windowStart)) {
        hourlyMap.get(windowStart).push(tx);
      }
    }

    return Array.from(hourlyMap.entries());
  }
}

module.exports = TransactionProcessor;
