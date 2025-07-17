const express = require("express");
const router = express.Router();
const asyncMiddleware = require("../middleware/asyncMiddleware");
const { fetchTokenTransfers } = require("../services/externalAPIs/moralisAPI");
const { processTransactions } = require("../services/transactionProcesseor");

router.get(
  "/summary",
  asyncMiddleware(async (req, res) => {
    const response = { data: null, message: null, error: null };
    // try {
      if (!req.query.address) {
        response.message = "Token address query parameter is required.";
        return res.status(400).json(response);
      }
      response.data = await processTransactions(req.query.address);
      response.message = "Token transactions fetched successfully.";
      res.status(200).json(response);
    // } catch (error) {
    //   response.error = error.message || "An error occurred";
    //   res.status(500).json(response);
    // }
  })
);

module.exports = router;
