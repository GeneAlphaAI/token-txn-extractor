const path = require("path");
const errorMiddleware = require("../middleware/errorMiddleware");
const { transactionRouter } = require("../routes");

module.exports = function (app) {
  app.get("/", (req, res) => {
    res.send("Welcome to the Node.js API!");
  });
  // Routes start
  app.use("/api/token/transactions", transactionRouter);

  // catch 404 and forward to error handler
  // app.use(function (req, res, next) {
  //   next(throwNoDataFoundError("The content you requested was not found."));
  // });

  // Handle errors
  app.use(errorMiddleware);
};
