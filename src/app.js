const express = require("express");
const chalk = require("chalk");
const routes = require("./setup/routes");
const appSetup = require("./setup/appSetup");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup (body parser, etc.)
app.use(express.json());

appSetup(app);

// Routes
routes(app);

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
