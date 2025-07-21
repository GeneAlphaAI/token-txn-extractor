const express = require('express');
const security = require('helmet');
const requestLogger = require('morgan');
const crossOrigin = require('cors');

const log = require('../utils/logger');
const AppError = require('../utils/appUtils').CustomError;
const { ALLOWED_ORIGINS, ERROR_INVALID_CORS_ORIGIN } = require('../utils/config');

/**
 * Configures essential application middleware
 * @param {express.Application} app - Express application instance
 */
const configureMiddleware = (app) => {
  // Body parsing middleware
  app.use([
    express.json(),
    express.urlencoded({ extended: true })
  ]);

  // Security middleware
  app.use(security());

  // Request logging
  app.use(requestLogger('tiny', { stream: log.stream }));

  // Cross-Origin Resource Sharing configuration
  app.use(crossOrigin({
    origin: validateOrigin,
    credentials: true
  }));
};

/**
 * Validates request origin against allowed origins
 * @param {string} origin - Request origin
 * @param {function} callback - CORS callback
 */
function validateOrigin(origin, callback) {
  const allowedOrigins = ALLOWED_ORIGINS;
  
  if (!origin || allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  
  callback(
    new AppError(
      'CORS policy restricts access from this origin',
      ERROR_INVALID_CORS_ORIGIN
    ),
    false
  );
}

module.exports = configureMiddleware;