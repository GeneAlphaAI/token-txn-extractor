# token-txn-extractor

## Description
token-txn-extractor is a Node.js backend service designed to extract, process, and analyze token transaction data from the blockchain. It leverages the Moralis API and Web3 technologies to fetch token transfers, process transaction details, and generate detailed hourly window analytics including buy/sell counts, token volumes, price statistics, and market data.

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd token-txn-extractor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory and configure necessary environment variables (e.g., PORT, Moralis API keys).

## Usage

### Running the server

- For development (with auto-reload):
  ```bash
  npm run dev
  ```

- For production:
  ```bash
  npm start
  ```

The server will start on the port specified in the `.env` file or default to port 3000.

### API Endpoint

- **GET** `/api/token/transactions/summary`

  Fetches and processes token transactions for a given token address and returns an hourly window summary analysis.

  **Query Parameters:**

  - `address` (required): The Ethereum token contract address to fetch transactions for.

  **Example Request:**

  ```
  GET /api/token/transactions/summary?address=0x1234567890abcdef1234567890abcdef12345678
  ```

  **Example Response:**

  ```json
  {
    "data": [
      {
        "hourStartUTC": "2023-06-01 12:00:00",
        "hourEndUTC": "2023-06-01 13:00:00",
        "totalTxns": 15,
        "buyCount": 10,
        "sellCount": 5,
        "activeAddressCount": 8,
        "lastTokenPrice": 0.25,
        "latestTokenPrice": 0.28,
        "avgTokenPrice": 0.26,
        "tokenVolume": "1500.00",
        "tokenVolumeUSD": "390.00",
        "ethPrice": "1800.50",
        "btcPrice": "32000.75",
        "startBlock": 123456,
        "endBlock": 123468,
        "transactionHashes": "0xabc..., 0xdef..., ...",
        "multiSwap": "Yes"
      }
    ],
    "message": "Token transactions fetched successfully.",
    "error": null
  }
  ```

## Features

- Fetches token transfer transactions using Moralis API.
- Processes and filters transactions for accuracy.
- Retrieves detailed transaction data including block timestamps.
- Generates hourly window analytics with buy/sell counts, token volumes, and price statistics.
- Supports concurrency control for efficient data processing.
- Provides a simple REST API endpoint for easy integration.

## Technologies Used

- Node.js
- Express.js
- Moralis API
- Web3.js
- Ethers.js
- Axios
- dotenv
- Helmet
- Morgan
- Winston

## License

This project is licensed under the ISC License.
