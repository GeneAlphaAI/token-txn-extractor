const express = require("express");
const chalk = require("chalk");
const routes = require("./setup/routes");
const appSetup = require("./setup/appSetup");
const { initializeTokenPricesFromFiles } = require("./utils/web3Utils");
const { getTransactionDetails, identifyNProcessTxns } = require("./services/web3Services/txnDataExtractor");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup (body parser, etc.)
app.use(express.json());

appSetup(app);

// Routes
routes(app);

// load the BTC and ETH price dataset
initializeTokenPricesFromFiles().then()


// identifyNProcessTxns("0xe88e8389ebf7e2c9b3c3ac88638bd8165519716a90d1d9682f6085220f33539d").then( 
//   (txnDetails) => {
//     console.log(chalk.green("Transaction Details: "), txnDetails);
//   }
// ).catch((error) => {
//   console.error(chalk.red("Error fetching transaction details: "), error);
// });

app.listen(PORT, () => {
  console.log(
    chalk.hex("rgba(0, 45, 244, 1)")(
      chalk.underline(`... Listening at port: ${PORT} ...`)
    )
  );
  console.log(
    chalk.hex("#65ff00")(chalk.underline(`Server Started Successfully`))
  );
});
