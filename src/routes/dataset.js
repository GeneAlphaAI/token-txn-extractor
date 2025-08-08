const express = require("express");
const router = express.Router();
const asyncMiddleware = require("../middleware/asyncMiddleware");
const TransactionProcessor = require("../services/transactionProcesseor");
const logger = require("../utils/logger");
const processor = new TransactionProcessor();

router.get(
  "/generate",
  asyncMiddleware(async (req, res) => {
    const { address, fromDate, toDate } = req.query;
    const response = { data: null, message: null, error: null };

    if (!address || !fromDate || !toDate) {
      logger.warn(`Required parameters missing`);
      response.message = "Required parameters missing.";
      return res.status(400).json(response);
    }
    await processor.generateWethDataset(address, fromDate, toDate);
    response.data = true;
    response.message = "Dataset creation proesss started successfully.";
    res.status(200).json(response);
  })
);

module.exports = router;
