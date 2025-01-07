import { JsonRpcProvider } from "ethers";
import { NFTIndexer } from "../indexer";
import { TokenTransfer } from "../types";

// Global indexer instance
let indexer: NFTIndexer;

async function main() {
  // Initialize provider with ApeChain RPC (force HTTP)
  const provider = new JsonRpcProvider("https://apechain.calderachain.xyz/http", undefined, {
    polling: true, // Force HTTP polling instead of WebSocket
    staticNetwork: true // Prevent network auto-detection which might trigger WebSocket
  });
  
  // NFT contract address
  const contractAddress = "0x91417bd88af5071ccea8d3bf3af410660e356b06";
  
  // Initialize indexer with custom configuration
  indexer = new NFTIndexer(contractAddress, provider, {
    startBlock: 3680981, // Start from genesis
    batchSize: 2000,
    cacheTimeout: 3600000, // 1 hour
    dbPath: "./data/bayc-indexer"
  });

  // Set up event handlers
  indexer.on("sync", (progress) => {
    const percentage = ((progress.current / progress.target) * 100).toFixed(2);
    console.log(`Sync progress: ${progress.current}/${progress.target} (${percentage}%)`);
  });

  indexer.on("transfer", (transfer: TokenTransfer) => {
    console.log(`Transfer: Token ${transfer.tokenId} from ${transfer.from} to ${transfer.to}`);
  });

  try {
    // Initialize and start syncing
    console.log("Initializing indexer...");
    await indexer.init();
    console.log("Indexer initialized successfully");

    // Example queries
    const tokenId = "1234";
    const owner = await indexer.getTokenOwner(tokenId);
    console.log(`Current owner of token ${tokenId}: ${owner}`);

    const metadata = await indexer.getTokenMetadata(tokenId);
    console.log(`Token ${tokenId} metadata:`, metadata);

    const transfers = await indexer.getTokenTransfers(tokenId);
    console.log(`Transfer history for token ${tokenId}:`, transfers);

    // Example: Get all tokens owned by an address
    const ownerAddress = "0x9E3c0Ac6d9cBFBa8DDEd606f04b80bC4766DF47b"; // Replace with actual address
    const ownedTokens = await indexer.getOwnerTokens(ownerAddress);
    console.log(`Tokens owned by ${ownerAddress}:`, ownedTokens);

  } catch (error) {
    console.error("Error:", error);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  await indexer.close();
  process.exit(0);
});

// Run the example
if (require.main === module) {
  main().catch(console.error);
  console.log('\nIndexer is running and listening for events. Press Ctrl+C to stop.');
}
