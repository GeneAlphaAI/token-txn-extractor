const {
  identifyNProcessWethTxns,
} = require("./web3Services/wethDataExtractor");
const fs = require("fs");
const path = require("path");
const { createWriteStream } = require("fs");
const { stringify } = require("csv-stringify");
const csv = require("csv-parser");
const readline = require("readline");
const { logger } = require("../utils/logger");

class WethTransactionProcessor {
  static BATCH_SIZE = 500;
  static CONCURRENCY = 5;

  constructor() {}

  async generateWethDataset(tokenAddress, fromDate, toDate) {
    const pMap = (await import("p-map")).default;
    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);
    if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime()))
      throw new Error(`Invalid date format.`);
    if (fromDateObj > toDateObj)
      throw new Error(`fromDate cannot be after toDate`);

    console.log(
      `Processing historical data for ${tokenAddress} from ${fromDate} to ${toDate}`
    );

    const outputDir = path.join(__dirname, "..", "output", tokenAddress);
    fs.mkdirSync(outputDir, { recursive: true });

    let batch = [];
    let batchCount = 0;

    // Read hashes from file in streaming mode
    const rl = readline.createInterface({
      input: fs.createReadStream(
        path.join(__dirname, "../resources/clean_data.csv")
      ),
      crlfDelay: Infinity,
    });

    // TODO convert forloop into map
    for await (const line of rl) {
      const hash = line.trim();
      if (!hash || hash === "hash") continue; // skip header or empty lines

      batch.push(hash);

      if (batch.length >= WethTransactionProcessor.BATCH_SIZE) {
        batchCount++;
        await this.processBatch(
          batch,
          tokenAddress,
          fromDateObj,
          toDateObj,
          pMap,
          batchCount
        );
        batch.length = 0;
        if (global.gc) global.gc();
      }
    }

    // process leftover batch
    if (batch.length > 0) {
      batchCount++;
      await this.processBatch(
        batch,
        tokenAddress,
        fromDateObj,
        toDateObj,
        pMap,
        batchCount
      );

      batch.length = 0;
    }

    if (global.gc) global.gc();
    console.log(`🎉 Done. Processed ${batchCount} batches.`);

    return {
      message: "WETH dataset generation Started.",
      success: true,
    };
  }

  async processBatch(
    batch,
    tokenAddress,
    fromDateObj,
    toDateObj,
    pMap,
    batchCount
  ) {
    console.log(
      `Processing batch ${batchCount}, number of transactions: ${batch.length}`
    );
    const outputFilename = path.join(
      __dirname,
      "..",
      "output",
      tokenAddress,
      `weth_batch_${batchCount}.csv`
    );

    let validTxDetails = await pMap(
      batch,
      async (tx) => {
        try {
          const txDetails = await identifyNProcessWethTxns(tx, true);
          logger.info(`${txDetails?.type || "Invalid"}`);
          if (!txDetails) return null;
          return { ...txDetails, txHash: tx };
        } catch (error) {
          console.error(`Failed to process ${tx}: ${error.message}`);
          return null;
        }
      },
      { concurrency: WethTransactionProcessor.CONCURRENCY }
    );

    validTxDetails = validTxDetails
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);

    console.log(
      `Found ${validTxDetails.length} valid transactions in batch ${batchCount}`
    );

    if (validTxDetails.length > 0) {
      let windows = this.createMinuteWindows(
        validTxDetails,
        Math.floor(fromDateObj.getTime() / 1000),
        Math.floor(toDateObj.getTime() / 1000)
      );

      let windowResults = await Promise.all(
        windows.map(async ([windowStart, txns]) => {
          if (txns.length > 0)
            return this.buildMinWindowOfWeth(windowStart, txns);
          return null;
        })
      );

      let finalResults = windowResults.filter(Boolean).reverse();
      await this.saveDatasetToCSV(finalResults, outputFilename);
      console.log(
        `🎉 Saved ${finalResults.length} minutes of data in batch ${batchCount}`
      );

      finalResults = null;
      windowResults = null;
      windows = null;
    }

    validTxDetails = null;
    if (global.gc) global.gc();

    batch.length = null;
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
        .pipe(csv({ headers: false })) // Don't auto-parse headers
        .on("data", (row) => {
          // When headers:false, row will be like { '0': '0x...' }
          const firstValue = row[0] || Object.values(row)[0];
          if (firstValue) {
            transactionHashes.add(firstValue.trim());
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

  buildMinWindowOfWeth(windowStart, transactions) {
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

  async saveDatasetToCSV(data, outputPath) {
    return new Promise((resolve, reject) => {
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

        // Create write stream
        const outputStream = createWriteStream(outputPath);

        // Create CSV stringifier with same options as before
        const stringifier = stringify({
          header: true,
          columns: fields,
          quoted: true, // Maintains the same quoting behavior
          quoted_empty: true,
          cast: {
            // Maintain same number formatting
            number: (value) => value.toString(),
          },
        });

        // Pipe the stringifier to the output file
        stringifier.pipe(outputStream);

        // Write each data row
        data.forEach((row) => {
          stringifier.write(row);
        });

        // Handle errors and completion
        stringifier.on("error", (err) => {
          console.error(`CSV stream error: ${err.message}`);
          reject(err);
        });

        outputStream.on("error", (err) => {
          console.error(`File write error: ${err.message}`);
          reject(err);
        });

        outputStream.on("finish", () => {
          resolve();
        });

        // End the stream
        stringifier.end();
      } catch (err) {
        console.error(`Failed to initialize CSV stream: ${err.message}`);
        reject(err);
      }
    });
  }
}

module.exports = WethTransactionProcessor;
