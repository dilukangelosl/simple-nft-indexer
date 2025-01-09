import { JsonRpcProvider } from "ethers";
import { NFTIndexer } from "../indexer";
import { TokenTransfer } from "../types";
import { Database } from '../db/index';
import { log } from '../utils/logger';
import dotenv from 'dotenv'
dotenv.config();

// Global instances
let indexer: NFTIndexer;
let db: Database;

async function main() {
  // Check database configuration
  if (!process.env.DATABASE_URL) {
    log.warn('DATABASE_URL environment variable not set. Please configure database connection to run this example.');
    log.info('Example: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres');
    log.info('Optional: Set DB_DROP_ON_INIT=true to drop existing tables and start fresh');
    process.exit(0);
  }

  // Initialize provider with ApeChain RPC (force HTTP)
  const provider = new JsonRpcProvider("https://apechain.calderachain.xyz/http", undefined, {
    polling: true, // Force HTTP polling instead of WebSocket
    staticNetwork: true // Prevent network auto-detection which might trigger WebSocket
  });
  
  // NFT contract address
  const contractAddress = "0x91417bd88af5071ccea8d3bf3af410660e356b06";
  
  try {
    // Initialize database connection
    // Set DB_DROP_ON_INIT=true to drop existing tables and start fresh
    db = Database.getInstance({
      connectionString: process.env.DATABASE_URL,
      tablePrefix: process.env.DB_TABLE_PREFIX || 'nft_idx_',
      maxConnections: Number(process.env.DB_MAX_CONNECTIONS) || 5,
      ssl: process.env.DB_SSL === 'true',
      dropOnInit: process.env.DB_DROP_ON_INIT === 'true', // Drop and recreate tables if true
    });

    await db.initialize();
    log.info('Database initialized successfully');

    // Initialize indexer with custom configuration - using PostgreSQL
    indexer = new NFTIndexer(contractAddress, provider, {
      startBlock: 3680981, // Start from genesis
      batchSize: 2000, // Smaller batch size to avoid timeouts
      cacheTimeout: 3600000, // 1 hour
      maxConcurrent: 2, // Limit concurrent requests
      pollInterval: 15000, // Increased poll interval
      database: db // Use PostgreSQL instead of LevelDB
    });

    // Set up event handlers
    indexer.on("sync", (progress) => {
      const percentage = ((progress.current / progress.target) * 100).toFixed(2);
      console.log(`Sync progress: ${progress.current}/${progress.target} (${percentage}%)`);
    });

    indexer.on("transfer", async (transfer: TokenTransfer) => {
      console.log(`Transfer: Token ${transfer.tokenId} from ${transfer.from} to ${transfer.to}`);
      
      // No need to manually store transfer in database
      // The indexer will handle storing transfers with metadata
    });

    // Initialize and start syncing
    console.log("Initializing indexer...");
    await indexer.init();
    console.log("Indexer initialized successfully");

    // Example queries using the indexer (which now uses PostgreSQL internally)
    const tokenId = "1234";
    
    // Get current owner
    const owner = await indexer.getTokenOwner(tokenId);
    console.log(`Current owner of token ${tokenId}: ${owner}`);

    // Get token metadata
    const metadata = await indexer.getTokenMetadata(tokenId);
    console.log(`Token ${tokenId} metadata:`, metadata);

    // Get all tokens owned by an address
    const ownerAddress = "0x9E3c0Ac6d9cBFBa8DDEd606f04b80bC4766DF47b";
    const ownedTokens = await indexer.getOwnerTokens(ownerAddress);
    console.log(`Tokens owned by ${ownerAddress}:`, ownedTokens);

    // Get database table information
    const tableInfo = await db.getTableInfo();
    log.info('PostgreSQL table information:', tableInfo);
  } catch (error) {
    log.error('Error in database example', error as Error);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  if (indexer) await indexer.close();
  if (db) await db.disconnect();
  process.exit(0);
});

// Run the example
if (require.main === module) {
  main().catch(console.error);
  console.log('\nIndexer is running with database integration. Press Ctrl+C to stop.');
}

export { main };
