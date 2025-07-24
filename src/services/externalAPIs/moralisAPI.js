const Moralis = require("moralis").default;
const { EvmChain } = require("@moralisweb3/common-evm-utils");
require("dotenv").config();

const { MORALIS_KEY } = process.env;

let moralisStarted = false;

async function startMoralis() {
  if (!moralisStarted) {
    await Moralis.start({
      apiKey: MORALIS_KEY,
    });
    moralisStarted = true;
  }
}

async function fetchTokenTransfers(tokenAddress, itrations = 1) {
  try {
    await startMoralis();

    console.log(`Fetching transfers for token: ${tokenAddress}`);

    const chain = EvmChain.ETHEREUM;
    const limit = 100;
    let cursor = null;
    const allTransfers = [];

    for (let i = 0; i < itrations; i++) {
      const response = await Moralis.EvmApi.token.getTokenTransfers({
        chain,
        address: tokenAddress,
        limit,
        cursor,
        order: "DESC",
      });

      const transfers = response.result;
      console.log(`Fetched ${transfers.length} transfers`);
      allTransfers.push(...transfers);

      // Update cursor for next page
      cursor = response.pagination?.cursor;

      // Break early if there are no more pages
      if (!cursor) break;
    }
    return allTransfers;
  } catch (error) {
    throw error;
  }
}

async function fetchTokenTransfersByDate(tokenAddress, fromDate, toDate) {
  try {
    await startMoralis();

    console.log(`Fetching transfers for token: ${tokenAddress} from ${fromDate} to ${toDate}`);

    // Validate dates
    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);
    
    if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
      throw new Error('Invalid date format. Please use YYYY-MM-DD format');
    }
    if (fromDateObj > toDateObj) {
      throw new Error(`Invalid date range: fromDate (${fromDate}) cannot be after toDate (${toDate})`);
    }

    const chain = EvmChain.ETHEREUM;
    const limit = 100;
    let cursor = null;
    const allTransfers = [];

    while (true) {
      const response = await Moralis.EvmApi.token.getTokenTransfers({
        chain,
        address: tokenAddress,
        limit,
        cursor,
        order: "DESC",
        fromDate: fromDate,  
        toDate: toDate      
      });

      const transfers = response.result;
      allTransfers.push(...transfers);

      // Update cursor for next page
      cursor = response.pagination?.cursor;
      if (!cursor || transfers.length < limit) break;
    }

    console.log(`Found ${allTransfers.length} transfers within date range`);
    return allTransfers;
  } catch (error) {
    console.error("Error fetching token transfers by date:", error.message);
    throw error;
  }
}
module.exports = { fetchTokenTransfers, fetchTokenTransfersByDate };
