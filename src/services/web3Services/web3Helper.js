const { ethers } = require("ethers");
const {
  blockchainHttpProvider,
  transferEventSignatures,
  createPairTokenHandler,
} = require("../../utils/web3Utils");
const v2PollABI = require("../../resources/ABIs/v2-pool-abi.json");
const logger = require("../../utils/logger");
const Config = require("../../utils/config");

const {
  RPC_HTTP,
  WETH_ADDRESS,
  WBTC_ADDRESS,
  DAI_ADDRESS,
  USDT_ADDRESS,
  USDC_ADDRESS,
} = process.env;

/**
 * Unpacks Uniswap V3 swap event log data
 *
 * @param {string} hex - Raw hex data from log
 * @returns {{amount0: number, amount1: number, negativeValue: number}} Parsed swap data
 */
function decodeV3SwapDataHex(hex) {
  const result = blockchainHttpProvider.eth.abi.decodeParameters(
    [
      { type: "int256", name: "amount0" },
      { type: "int256", name: "amount1" },
      { type: "uint160", name: "sqrtPriceX96" },
      { type: "uint128", name: "liquidity" },
      { type: "int24", name: "tick" },
    ],
    hex
  );

  const amt0 = parseInt(BigInt(result.amount0));
  const amt1 = parseInt(BigInt(result.amount1));

  return amt0 > 0
    ? { amount0: amt0, amount1: amt1 * -1, negativeValue: amt1 * -1 }
    : { amount0: amt0 * -1, amount1: amt1, negativeValue: amt0 * -1 };
}

/**
 * Parses Uniswap V2 swap event log
 *
 * @param {object} log - Log object from transaction receipt
 * @returns {{amount0: number, amount1: number, swapLog: object}} Parsed amounts and log
 */
function decodeV2SwapDataHex(log) {
  const parsed = blockchainHttpProvider.eth.abi.decodeParameters(
    [
      { type: "uint256", name: "amount0In" },
      { type: "uint256", name: "amount1In" },
      { type: "uint256", name: "amount0Out" },
      { type: "uint256", name: "amount1Out" },
    ],
    log.data
  );

  const a0 = parseInt(BigInt(parsed.amount0In));
  const a1 = parseInt(BigInt(parsed.amount1Out));
  const b0 = parseInt(BigInt(parsed.amount1In));
  const b1 = parseInt(BigInt(parsed.amount0Out));

  return parsed.amount0Out > 0
    ? { amount0: b0, amount1: b1, swapLog: log }
    : { amount0: a0, amount1: a1, swapLog: log };
}

function decodeV2ReservesHex(log) {
  const decoded = blockchainHttpProvider.eth.abi.decodeParameters(
    [
      { type: "uint112", name: "reserve0" },
      { type: "uint112", name: "reserve1" },
    ],
    log.data
  );

  return {
    reserve0: parseFloat(decoded.reserve0),
    reserve1: parseFloat(decoded.reserve1),
    timestamp: parseInt(decoded.blockTimestampLast),
    reserveLog: log,
  };
}

async function getWETHTransferLog(receipt, swap) {
  let matchedLog = null;
  let amount = 0;

  for (const entry of receipt.logs) {
    if (
      transferEventSignatures.includes(entry.topics[0]) &&
      entry.address.toLowerCase() === WETH_ADDRESS.toLowerCase()
    ) {
      amount = decodeTransferDataHex(entry.data);
      if (amount === swap.amount0 || amount === swap.amount1) {
        matchedLog = entry;
        break;
      }
    }
  }
  return { dstLog: matchedLog, value: amount };
}

async function getWBTCTransferLog(receipt, swap) {
  let matchedLog = null;
  let amount = 0;

  for (const entry of receipt.logs) {
    if (
      transferEventSignatures.includes(entry.topics[0]) &&
      entry.address.toLowerCase() === WBTC_ADDRESS.toLowerCase()
    ) {
      amount = decodeTransferDataHex(entry.data);
      if (amount === swap.amount0 || amount === swap.amount1) {
        matchedLog = entry;
        break;
      }
    }
  }
  return { dstLog: matchedLog, value: amount };
}

async function getUSDTransferLog(receipt, swap) {
  let match = null;
  let amount = 0;
  const lowerAddr = (addr) => addr.toLowerCase();

  for (const log of receipt.logs) {
    const address = lowerAddr(log.address);
    if (
      transferEventSignatures.includes(log.topics[0]) &&
      [USDT_ADDRESS, USDC_ADDRESS, DAI_ADDRESS].some(
        (token) => lowerAddr(token) === address
      )
    ) {
      amount = decodeTransferDataHex(log.data);
      match = log;
      break;
    }
  }
  return { dstLog: match, value: amount };
}

async function getUSDMultiSwapTransferLog(receipt, swap) {
  return getUSDTransferLog(receipt, swap);
}

function isDifferenceUnder10Percent(valA, valB) {
  const max = Math.max(valA, valB);
  const min = Math.min(valA, valB);
  const variance = max - min;
  return (variance / max) * 100 < 10;
}

async function getTokenTransferLog(receipt, swap, includesUSD, ethAmount) {
  let logMatch = null;
  let derivedValue = 0;
  const expectedTokenAmt =
    swap.amount0 === ethAmount ? swap.amount1 : swap.amount0;

  for (const item of receipt.logs) {
    if (!transferEventSignatures.includes(item.topics[0]) || item.data === "0x")
      continue;

    const addr = item.address.toLowerCase();
    const val = decodeTransferDataHex(item.data);

    const isValidToken = includesUSD
      ? ![WETH_ADDRESS, USDT_ADDRESS, USDC_ADDRESS, DAI_ADDRESS,WBTC_ADDRESS].includes(addr)
      : addr !== WETH_ADDRESS.toLowerCase();

    if (
      isValidToken &&
      (val === expectedTokenAmt ||
        isDifferenceUnder10Percent(val, expectedTokenAmt))
    ) {
      logMatch = item;
      derivedValue = val;
      break;
    }
  }

  if (!logMatch) {
    for (const log of receipt.logs) {
      if (!transferEventSignatures.includes(log.topics[0]) || log.data === "0x")
        continue;
      const addr = log.address.toLowerCase();

      if (
        includesUSD &&
        ![WETH_ADDRESS, USDT_ADDRESS, USDC_ADDRESS, DAI_ADDRESS].includes(
          addr
        ) &&
        log?.topics?.[2]?.toLowerCase() === receipt.to.toLowerCase()
      ) {
        logMatch = log;
        derivedValue = swap.amount0 === ethAmount ? swap.amount1 : swap.amount0;
        break;
      }

      if (!includesUSD && addr !== WETH_ADDRESS.toLowerCase()) {
        const fromAddr = decodeAddressHexToAddress(log.topics[1]);
        const toAddr = decodeAddressHexToAddress(log.topics[2]);
        const matchFrom = fromAddr.toLowerCase() === receipt.from.toLowerCase();
        const matchTo = toAddr.toLowerCase() === receipt.from.toLowerCase();

        if (matchFrom || matchTo) {
          logMatch = log;
          derivedValue =
            swap.amount0 === ethAmount ? swap.amount1 : swap.amount0;
          break;
        }
      }
    }
  }

  return { dstLog: logMatch, tokenValue: derivedValue };
}

function decodeTransferDataHex(data) {
  const decoded = blockchainHttpProvider.eth.abi.decodeParameters(
    [{ type: "uint256", name: "wad" }],
    data
  );
  return parseInt(BigInt(decoded.wad));
}

function getSpotPrice(resAlt, resBase, decAlt = 18, decBase = 18) {
  const normAlt = Number(resAlt) / 10 ** decAlt;
  const normBase = Number(resBase) / 10 ** decBase;
  return normBase / normAlt;
}

function decodeAddressHexToAddress(hex) {
  const decoded = blockchainHttpProvider.eth.abi.decodeParameters(
    [{ type: "address", name: "address" }],
    hex
  );
  return decoded.address;
}

async function isContractAddress(address) {
  try {
    const code = await blockchainHttpProvider.eth.getCode(address);
    return code !== "0x" && code !== "0x0";
  } catch (err) {
    console.error("Unable to verify contract:", err);
    return false;
  }
}

async function isERC20(address) {
  const provider = new ethers.providers.JsonRpcProvider({ url: RPC_HTTP }, 1);
  const bytecode = await provider.getCode(address);

  if (bytecode === "0x") return false;

  const signatures = {
    Transfer:
      "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    Approval:
      "8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  };

  const hasTransfer = bytecode.includes(signatures.Transfer);
  const hasApproval = bytecode.includes(signatures.Approval);
  if (!hasTransfer || !hasApproval) return false;

  const abi = [
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)",
  ];

  const contract = new ethers.Contract(address, abi, provider);

  try {
    await Promise.all([
      contract.totalSupply(),
      contract.balanceOf("0x0000000000000000000000000000000000000000"),
      contract.allowance(
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000"
      ),
    ]);
    return true;
  } catch (e) {
    logger.error(e);
    return false;
  }
}

function extractMethodSelector(input) {
  return input.slice(0, 10);
}

async function getPairTokens(poolAddress) {
  const pool = createPairTokenHandler(v2PollABI, poolAddress);

  let baseToken, quoteToken;
  try {
    let [token0, token1] = await Promise.all([
      pool.methods.token0().call(),
      pool.methods.token1().call(),
    ]);

    token0 = token0.toLowerCase();
    token1 = token1.toLowerCase();

    if (
      Config.QUOTE_TOKENS.includes(token0) &&
      Config.QUOTE_TOKENS.includes(token1)
    ) {
      logger.warn(`Pool ${poolAddress} contains both quote tokens.`);
      return { poolAddress, baseToken: null, quoteToken: null };
    } else if (Config.QUOTE_TOKENS.includes(token0)) {
      quoteToken = token0;
      baseToken = token1;
    } else if (Config.QUOTE_TOKENS.includes(token1)) {
      baseToken = token0;
      quoteToken = token1;
    } else {
      // Bypassing ERC20 <--> ERC20 pair tokens
      logger.warn(`Pool ${poolAddress} does not contain a quote token.`);
      return { poolAddress, baseToken: null, quoteToken: null };
    }
    return { poolAddress, baseToken, quoteToken };
  } catch (error) {
    logger.error(error);
    return { poolAddress, baseToken: null, quoteToken: null };
  }
}

module.exports = {
  decodeV3SwapDataHex,
  decodeV2SwapDataHex,
  getWETHTransferLog,
  getUSDTransferLog,
  getTokenTransferLog,
  decodeTransferDataHex,
  decodeAddressHexToAddress,
  isContractAddress,
  isERC20,
  extractMethodSelector,
  decodeV2ReservesHex,
  getSpotPrice,
  getUSDMultiSwapTransferLog,
  getWBTCTransferLog,
  getPairTokens
  
};
