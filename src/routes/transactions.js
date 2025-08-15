const express = require("express");
const router = express.Router();
const asyncMiddleware = require("../middleware/asyncMiddleware");
const TransactionProcessor = require("../services/transactionProcessor");
const logger = require("../utils/logger");
const processor = new TransactionProcessor();

router.get(
  "/summary",
  asyncMiddleware(async (req, res) => {
    const response = { data: null, message: null, error: null };

    if (!req.query.address) {
      response.message = "Token address query parameter is required.";
      return res.status(400).json(response);
    }
    response.data = await processor.generateTokenHourlyData(req.query.address);
    response.message = "Token transactions data fetched successfully.";
    res.status(200).json(response);
  })
);

router.get(
  "/historical/summary",
  asyncMiddleware(async (req, res) => {
    const { address, fromDate, toDate, page = 1, limit = 20 } = req.query;
    const response = { data: null, message: null, error: null };

    if (!address || !fromDate || !toDate) {
      logger.warn(`Required parameters missing`);
      response.message = "Required parameters missing.";
      return res.status(400).json(response);
    }

    response.data = await processor.generateTokenHistoricalData(
      address,
      fromDate,
      toDate,
      parseInt(page),
      parseInt(limit)
    );
    response.message =
      "Token transactions historical data fetched successfully.";
    res.status(200).json(response);
  })
);

module.exports = router;
