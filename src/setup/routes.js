
const errorMiddleware = require("../middleware/errorMiddleware");
const { transactionRouter,datasetRouter } = require("../routes");
const { CustomError } = require("../utils/appUtils");

module.exports = function (app) {
  app.get("/", (req, res) => {
    res.send("Welcome to Token Transaction Extractor Service");
  });
  // Routes start
  app.use("/api/token/transactions", transactionRouter);
  app.use("/api/token/dataset", datasetRouter);

  app.use("/docs", (req, res, next) =>
    res.redirect("https://documenter.getpostman.com/view/33425726/2sB34ikfPv")
  );

  // Catch 404 and forward to error handler
  app.use(function (req, res, next) {
    next(new CustomError("No Route found", "Not Found 404"));
  });

  // Handle errors
  app.use(errorMiddleware);
};
