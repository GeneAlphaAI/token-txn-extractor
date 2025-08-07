module.exports = class Config {
  static ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"; // somewhere in constants.js
  static DEAD_ADDRESS =
    "0x000000000000000000000000000000000000dEaD".toLowerCase();

  static MINIMUM_ETH_BALANCE = 0.0000005;

  static TRANSACTION_TYPES = {
    BOTH: "BOTH",
    BUY: "BUY",
    SELL: "SELL",
  };

    // Log Topics
  static UNISWAP_V2_SWAP_TOPIC =
    "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
  static UNISWAP_V3_SWAP_TOPIC =
    "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
  static TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  static TransformedERC20_TOPIC =
    "0x0f6672f78a59ba8e5e5b5d38df3ebc67f3c792e2c9259b8d97d7f00dd78ba1b3";
  static WITHDRAWL_TOPIC =
    "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
  static APPROVAL_TOPIC =
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";


  // Stable coins
  static WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  static DAI_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";
  static USDT_ADDRESS = "0xdac17f958d2ee523a2206206994597c13d831ec7";
  static USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  static TUSD_ADDRESS = "0x0000000000085d4780b73119b644ae5ecd22b376";
  static USDP_ADDRESS = "0x8e870d67f660d95d5be530380d0ec0bd388289e1";
  static WBTC_ADDRESS = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";

  static QUOTE_TOKENS = [
    this.WETH_ADDRESS.toLowerCase(),
    this.DAI_ADDRESS.toLowerCase(),
    this.USDT_ADDRESS.toLowerCase(),
    this.USDC_ADDRESS.toLowerCase(),
    this.TUSD_ADDRESS.toLowerCase(),
    this.USDP_ADDRESS.toLowerCase(),
    this.WBTC_ADDRESS.toLowerCase(),
  ];

  // Define allowed origins for CORS
  static ALLOWED_ORIGINS = ["http://localhost:8000"];

  // Errors
  static ERROR_NOT_FOUND = "NotFound";
  static ERROR_INACTIVE = "InactiveError";
  static ERROR_ALREADY_USED = "AlreadyUsedError";
  static ERROR_UNAUTHORIZED = "UnauthorizedError";
  static ERROR_INVALID_ADDRESS = "InvalidAddress";
  static ERROR_INVALID_QUERY = "InvalidQueryError";
  static ERROR_EMPTY_REQ_BODY = "EmptyRequestBody";
  static ERROR_INVALID_INPUT = "InvalidInputError";
  static ERROR_INVALID_CORS_ORIGIN = "InvalidCorsOrigin";

  constructor() {}
};
