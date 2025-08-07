const {
  identifyNProcessTxns,
} = require("./web3Services/txnDataExtractor");
const {
  fetchBlockTime,
  filterUniqueTransactions,
} = require("../utils/web3Utils");
const {
  fetchTokenTransfers,
  fetchTokenTransfersByDate,
} = require("./externalAPIs/moralisAPI");
const {
  identifyNProcessWethTxns,
} = require("./web3Services/wethDataExtractor");
const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv"); 
const csv = require('csv-parser');


class TransactionProcessor {
  static CONCURRENCY_LIMIT = 70;
  static BATCH_SIZE = 10000;
  static CONCURRENCY = 2000;

  constructor() {}

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

    const tokenPrices = buySellTxns.map((t) => {
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
    });

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
   * Builds a summary object for a 1-minute window of WETH transactions.
   *
   * Filters transactions for BUY and SELL types, calculates counts, volumes, prices, and other metrics.
   *
   * @async
   * @param {number} windowStart - The start timestamp (in seconds) of the window.
   * @param {Array<Object>} transactions - Array of transaction objects to process.
   * @param {string} transactions[].type - The transaction type ("BUY" or "SELL").
   * @param {number} [transactions[].ethAmount] - Amount of ETH involved in the transaction.
   * @param {number} [transactions[].usdValue] - USD value of the transaction.
   * @param {number} [transactions[].ethCurrentPrice] - Current ETH price at transaction time.
   * @param {number} [transactions[].btcCurrentPrice] - Current BTC price at transaction time.
   * @param {number} transactions[].blockNumber - Block number of the transaction.
   * @param {string} transactions[].txHash - Transaction hash.
   * @param {boolean} [transactions[].multiSwap] - Indicates if the transaction is a multi-swap.
   *
   * @returns {Promise<Object>} Summary of the window including counts, volumes, prices, block range, and other metrics.
   */
  async buildMinWindowOfWeth(windowStart, transactions) {
    const windowEnd = windowStart + 60; // 1 minute window
    const buySellTxns = transactions.filter(
      (t) => t.type === "BUY" || t.type === "SELL"
    );

    const buyCount = buySellTxns.filter((t) => t.type === "BUY").length;
    const sellCount = buySellTxns.filter((t) => t.type === "SELL").length;

    const tokenVolume = buySellTxns.reduce(
      (acc, t) => acc + (t.ethAmount || 0),
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

    const tokenPrices = buySellTxns.map((t) => {
      // if (t?.ethreserve && t?.tokenReserve && ethPrice) {
      //   return (t.ethreserve * ethPrice) / t.tokenReserve;
      // }
      if (t.ethCurrentPrice) {
        return t.ethCurrentPrice;
      }
      if (t.usdValue && t.ethAmount) {
        return t.usdValue / t.ethAmount;
      }
      return 0;
    });

    const avgPrice = tokenPrices.length
      ? tokenPrices.reduce((a, b) => a + b, 0) / tokenPrices.length
      : 0;
    const latestPrice = tokenPrices.length
      ? tokenPrices[tokenPrices.length - 1]
      : 0;

    const formatDateTime = (ts) =>
      new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);

    return {
      minStartUTC: formatDateTime(windowStart),
      minEndUTC: formatDateTime(windowEnd),
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
      // transactionHashes: transactions.map((t) => t.txHash).join(", "),
      // multiSwap: transactions.some((t) => t.multiSwap) ? "Yes" : "No",
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
            const txDetails = await identifyNProcessTxns(txHash);

            if (!txDetails?.blockNumber) {
              console.log(
                `[Details] Skipping ${txHash.slice(0, 8)} (missing details)`
              );
              return null;
            }
            console.log(
              `Processing  ${txHash.slice(0, 8)} - ${txDetails.blockNumber}`
            );
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
        `[Recency] No timestamp for block ${lastTxnInTheBatch?.blockNumber}`
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
  async generateTokenHistoricalData(
    tokenAddress,
    fromDate,
    toDate,
    page = 1,
    limit = 100
  ) {
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
        60,
        async (tx) => {
          try {
            const txDetails = await identifyNProcessTxns(tx, true);

            if (!txDetails) {
              console.log(`Skipping ${tx} - missing details`);
              return null;
            }
            console.log(`Processing ${tx} - ${txDetails.blockNumber}`);

            return {
              ...txDetails,
              txHash: tx,
            };
          } catch (error) {
            console.log(`Failed to process ${tx}: ${error.message}`);
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

      const windowResults = await Promise.all(
        hourlyWindows.map(async ([windowStart, transactions]) => {
          if (transactions.length > 0) {
            return await this.buildHourlyWindow(windowStart, transactions);
          }
          return null;
        })
      );

      const allResults = windowResults.filter(Boolean).reverse();

      // Pagination
      const total = allResults.length;
      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.max(1, Math.min(page, totalPages));
      const offset = (currentPage - 1) * limit;

      const paginatedResults = allResults.slice(offset, offset + limit);

      return {
        currentPage,
        totalPages,
        totalItems: total,
        perPage: limit,
        items: paginatedResults,
      };
    } catch (err) {
      console.error("Historical processing failed:", err);
      throw err;
    }
  }

  /**
   * Generates a WETH dataset for a given token address within a specified date range.
   * Processes historical transaction data in batches, extracts relevant transaction details,
   * organizes them into minute windows, and saves the results as CSV files.
   *
   * @async
   * @param {string} tokenAddress - The address of the token to process.
   * @param {string|Date} fromDate - The start date (inclusive) for transaction extraction (ISO string or Date object).
   * @param {string|Date} toDate - The end date (inclusive) for transaction extraction (ISO string or Date object).
   * @returns {Promise<{message: string, totalBatches: number, totalProcessed: number}>} - Summary of the dataset generation process.
   * @throws {Error} Throws if date formats are invalid or if fromDate is after toDate.
   */


async  generateWethDataset(tokenAddress, fromDate, toDate) {
  try {
    const pMap = (await import("p-map")).default;
    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);

    if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
      throw new Error(`Invalid date format.`);
    }
    if (fromDateObj > toDateObj) {
      throw new Error(`fromDate cannot be after toDate`);
    }

    console.log(
      `Processing historical data for ${tokenAddress} from ${fromDate} to ${toDate}`
    );

    const hashes = await this.extractTransactionHashes(
      path.join(__dirname, "../resources/clean_data.csv")
    );

    if (hashes.length === 0) {
      console.log("No hashes found.");
      return [];
    }

    console.log(`Found ${hashes.length} unique transactions`);

    const outputDir = path.join(__dirname, "..", "output", tokenAddress);
    fs.mkdirSync(outputDir, { recursive: true });

    let batchCount = 0;
    let totalProcessed = 0;

    for (let i = 0; i < hashes.length; i += TransactionProcessor.BATCH_SIZE) {
      const batch = hashes.slice(i, i + TransactionProcessor.BATCH_SIZE);
      const outputFilename = path.join(
        outputDir,
        `weth_batch_${batchCount + 1}.csv`
      );

      // Skip batch if already processed
      if (fs.existsSync(outputFilename)) {
        console.log(`⚠️ Skipping batch ${batchCount + 1} (already processed)`);
        batchCount++;
        continue;
      }

      console.log(
        `Processing batch ${batchCount + 1} (${batch.length} txs)...`
      );

      const txDetailsList = await pMap(
        batch,
        async (tx) => {
          try {
            const txDetails = await identifyNProcessWethTxns(tx, true);
            if (!txDetails) {
              console.log(`Skipping ${tx} - missing details`);
              return null;
            }
            totalProcessed++;
            console.log(`Processed ${tx} - ${txDetails.type || "UNKNOWN"}`);
            return {
              ...txDetails,
              txHash: tx,
            };
          } catch (error) {
            console.error(`Failed to process ${tx}: ${error.message}`);
            return null;
          }
        },
        { concurrency: TransactionProcessor.CONCURRENCY }
      );

      const validTxDetails = txDetailsList
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (validTxDetails.length === 0) {
        console.log(`Batch ${batchCount + 1} had no valid transactions.`);
        batchCount++;
        continue;
      }

      const windows = this.createMinuteWindows(
        validTxDetails,
        Math.floor(fromDateObj.getTime() / 1000),
        Math.floor(toDateObj.getTime() / 1000)
      );

      const windowResults = await Promise.all(
        windows.map(async ([windowStart, txns]) => {
          if (txns.length > 0) {
            return await this.buildMinWindowOfWeth(windowStart, txns);
          }
          return null;
        })
      );

      const finalResults = windowResults.filter(Boolean).reverse();

      await this.saveDatasetToCSV(finalResults, outputFilename);
      console.log(`✅ Batch ${batchCount + 1} saved: ${outputFilename}`);

      batchCount++;
    }

    console.log(
      `🎉 Done. Processed ${totalProcessed} valid transactions across ${batchCount} batches.`
    );

    return {
      message: "WETH dataset generation completed.",
      totalBatches: batchCount,
      totalProcessed,
    };
  } catch (err) {
    console.error("Historical processing failed:", err);
    throw err;
  }
}


  createMinuteWindows(transactions, fromTimestamp, toTimestamp) {
    const minuteMap = new Map();

    let currentWindowStart = Math.floor(fromTimestamp / 60) * 60;
    const endWindowStart = Math.floor(toTimestamp / 60) * 60;

    while (currentWindowStart <= endWindowStart) {
      minuteMap.set(currentWindowStart, []);
      currentWindowStart += 60;
    }

    for (const tx of transactions) {
      const windowStart = Math.floor(tx.timestamp / 60) * 60;
      if (minuteMap.has(windowStart)) {
        minuteMap.get(windowStart).push(tx);
      }
    }

    return Array.from(minuteMap.entries());
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

  extractTransactionHashes(inputFile) {
    return new Promise((resolve, reject) => {
      // Resolve to absolute path
      const absolutePath = path.resolve(inputFile);
      console.log(`Looking for CSV at: ${absolutePath}`);

      // Verify file exists first
      if (!fs.existsSync(absolutePath)) {
        return reject(new Error(`CSV file not found at: ${absolutePath}`));
      }

      const transactionHashes = new Set(); // Using Set to avoid duplicates

      fs.createReadStream(absolutePath)
        .pipe(csv())
        .on("data", (row) => {
          if (row.transaction_hash) {
            transactionHashes.add(row.transaction_hash.trim());
          }
        })
        .on("end", () => {
          if (transactionHashes.size === 0) {
            console.warn("Warning: No transaction hashes found in CSV");
          }
          resolve(Array.from(transactionHashes));
        })
        .on("error", (error) => {
          reject(new Error(`CSV read error: ${error.message}`));
        });
    });
  }

  async saveDatasetToCSV(data, outputPath) {
    try {
     const fields = [
  "minStartUTC",
  "minEndUTC",
  "startBlock",
  "endBlock",
  "totalTxns",
  "buyCount",
  "sellCount",
  "activeAddressCount",
  "lastTokenPrice",
  "latestTokenPrice",
  "avgTokenPrice",
  "tokenVolume",
  "tokenVolumeUSD",
  "ethPrice",
  "btcPrice",
];

      const opts = { fields };
      const csv = parse(data, opts);

      fs.writeFileSync(outputPath, csv);
    } catch (err) {
      console.error(`Failed to save dataset CSV: ${err.message}`);
      throw err;
    }
  }
}

module.exports = TransactionProcessor;
