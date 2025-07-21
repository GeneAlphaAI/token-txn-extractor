const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");

const logger = require("../utils/logger");
const { CustomError } = require("../utils/appUtils");
const Config = require("../utils/config");

module.exports = (app) => {

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));


  // Configure CORS middleware
  app.use(
    cors({
      origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (!Config.ALLOWED_ORIGINS.includes(origin)) {
          return callback(
            new CustomError(
              "The CORS policy for this site does not allow access from the specified Origin.",
              Config.ERROR_INVALID_CORS_ORIGIN
            ),
            false
          );
        }
        return callback(null, true);
      },
      credentials: true,
    })
  );

  app.use(helmet());
  app.use(morgan("tiny", { stream: logger.stream }));
};
