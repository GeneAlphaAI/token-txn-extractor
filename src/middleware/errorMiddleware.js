const Config = require("../utils/config");
const logger = require("../utils/logger");

module.exports = function (error, req, res, next) {
  logger.error(error);

  const response = { data: null, message: null, error: null };
  let code = 500;
  response.message = error.message;
  response.error = error.name;

  if (error.name === Config.ERROR_NOT_FOUND) code = 404;
  // else if (error.name === Config.ERROR_UNAUTHORIZED) code = 401;
  // else if (error.name === Config.ERROR_INVALID_SESSION_ID) code = 498;
  // // requires re-login when session is expired
  // else if (error.name === Config.ERROR_SESSION_EXPIRED) code = 440;
  else if (
    error.name === Config.ERROR_INVALID_ADDRESS ||
    error.name === Config.ERROR_INVALID_QUERY ||
    error.name === Config.ERROR_EMPTY_REQ_BODY
  )
    code = 400;

  res.status(code).send(response);
};
