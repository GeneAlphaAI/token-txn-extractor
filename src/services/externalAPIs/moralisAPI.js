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

module.exports = { fetchTokenTransfers };
