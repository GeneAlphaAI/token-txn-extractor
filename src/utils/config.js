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

  // Define allowed origins for CORS
  static ALLOWED_ORIGINS = [
    "http://localhost:5013",

  ];

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

  static BLACK_LISTED_ADDRESSES = [
    "0x0000000000A39bb272e79075ade125fd351887Ac".toLowerCase(), // BLUR_POOL_ADDRESS
  ];

  constructor() {}
};
