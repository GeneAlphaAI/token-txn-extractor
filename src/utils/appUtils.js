const { default: Web3 } = require("web3");
const Config = require("./config");

class ValidationError extends Error {
  constructor(errorMessage, errorType) {
    super(errorMessage);
    this.message = errorMessage;
    this.name = errorType;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(errorMessage)).stack;
    }
  }
}

function checkEmptyValue(inputValue) {
  return (
    inputValue === undefined ||
    inputValue === null ||
    (typeof inputValue === "object" &&
      Object.keys(inputValue).length === 0 &&
      inputValue.constructor === Object)
  );
}

function convertToChecksumFormat(addressString) {
  return Web3.utils.toChecksumAddress(addressString);
}

function processNestedData(inputObject) {
  const processingStack = [{ data: inputObject }];

  while (processingStack.length > 0) {
    const { data: currentData } = processingStack.pop();

    if (typeof currentData === "object" && currentData !== null) {
      for (const property in currentData) {
        if (currentData.hasOwnProperty(property)) {
          let propertyValue = currentData[property];

          if (typeof propertyValue === "bigint") {
            currentData[property] = Number(propertyValue);
          } else if (typeof propertyValue === "object" && propertyValue !== null) {
            processingStack.push({ data: propertyValue });
          }
        }
      }
    }
  }

  return inputObject;
}

function verifyAddressFormat(addressToVerify) {
  if (addressToVerify) {
    return convertToChecksumFormat(addressToVerify);
  } else {
    throw new ValidationError(
      `Cannot process with empty or invalid address.`,
      Config.ERROR_INVALID_ADDRESS
    );
  }
}

function raiseDataNotFound(messageText) {
  throw new ValidationError(messageText, Config.ERROR_NOT_FOUND);
}

function raiseInvalidQuery() {
  throw new ValidationError(
    "Invalid query. Query must have at least 3 characters.",
    Config.ERROR_INVALID_QUERY
  );
}

module.exports = {
  CustomError: ValidationError,
  deserializeObject: processNestedData,
  throwNoDataFoundError: raiseDataNotFound,
  throwInvalidQueryError: raiseInvalidQuery,
  validateAddress: verifyAddressFormat,
  addressToChecksum: convertToChecksumFormat,
  isEmptyObject: checkEmptyValue,
};