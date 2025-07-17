const winston = require("winston");
const ErrorStackParser = require("error-stack-parser");
const dotenv = require("dotenv");
dotenv.config();

class Logger {
  constructor(options = {}) {
    if (!Logger.instance) {
      Logger.instance = this;
      const { console = true, file = "combined.log" } = options;

      const transports = [];
      if (console) {
        transports.push(new winston.transports.Console());
      }
      if (file) {
        transports.push(new winston.transports.File({ filename: file }));
      }
      transports.push(new winston.transports.File({ filename: "app-error.log", level: "error" }));

      this.logger = winston.createLogger({
        level: process.env.LOG_LEVEL || "error",
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.printf(({ level, message, timestamp, stack }) => {
            return `${timestamp} [${level}]: ${message} ${stack ? "\n" + stack : ""}`;
          })
        ),
        transports: transports,
      });

      // Create a stream object with a 'write' function that will be used by Morgan
      this.stream = {
        write: (message) => {
          this.logger.info(message.trim());
        },
      };
    }
    return Logger.instance;
  }

  info(message) {
    this.logger.log({ level: "info", message: message });
  }

  warn(message) {
    this.logger.log({ level: "warn", message: message });
  }

  error(error) {
    const trace = ErrorStackParser.parse(error);
    const formattedStack = trace
      .map(
        (frame) =>
          `${frame.getFunctionName() || "anonymous"} (${frame.getFileName()}:${frame.getLineNumber()})`
      )
      .join("\n");
    this.logger.error(error.message, { stack: formattedStack });
  }
}

module.exports = new Logger({
  console: true,
});
