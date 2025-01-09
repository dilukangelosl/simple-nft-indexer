# Simple NFT Indexer

A lightweight and efficient NFT contract indexer with smart caching and minimal RPC calls. This library helps you track NFT ownership, transfers, and metadata while maintaining a local cache to reduce network requests.

## Features

- 🚀 Efficient historical sync with configurable batch sizes
- 💾 Flexible storage options (LevelDB or PostgreSQL)
- 🔄 Smart caching system for ownership and metadata
- 🎯 Minimal RPC calls with optimized data fetching
- 📊 Real-time transfer event monitoring
- 🔍 Comprehensive query methods for token data
- 📝 TypeScript support with full type definitions
- 🗄️ Production-ready with scalable PostgreSQL support

## Installation

```bash
# Using pnpm (recommended)
pnpm install simple-nft-indexer

# Using npm
npm install simple-nft-indexer

# Using yarn
yarn add simple-nft-indexer
```

## Storage Options

The indexer supports two storage backends, each with its own advantages:

### LevelDB (Default)
- **Advantages**:
  - Zero configuration required - just specify a directory path
  - Embedded database with no external dependencies
  - Perfect for development and testing
  - Lightweight and fast for small to medium datasets
  - Automatic data persistence in local files
  - Great for single-instance applications
  - Separate storage for ownership, transfers, and metadata
  - Full transfer history tracking

- **Best for**:
  - Development environments
  - Small to medium-scale applications
  - Single-instance deployments
  - Quick prototypes and testing
  - Applications needing detailed transfer history

### PostgreSQL
- **Advantages**:
  - Production-ready, scalable solution
  - Support for complex queries and data relationships
  - Better performance for large datasets
  - Built-in backup and replication
  - Connection pooling for high concurrency
  - Data integrity with ACID compliance
  - Unified storage model (all data in one table)
  - JSON support for metadata storage

- **Best for**:
  - Production environments
  - Large-scale applications
  - Multi-instance deployments
  - Complex querying requirements
  - Applications needing data replication

### Choosing a Storage Backend

Consider these factors when choosing between LevelDB and PostgreSQL:

1. **Scale of Your Application**
   - Small/Medium → LevelDB
   - Large/Enterprise → PostgreSQL

2. **Deployment Environment**
   - Development/Testing → LevelDB
   - Production → PostgreSQL

3. **Query Requirements**
   - Simple queries → LevelDB
   - Complex queries/relationships → PostgreSQL

4. **Infrastructure**
   - Minimal setup needed → LevelDB
   - Existing PostgreSQL infrastructure → PostgreSQL

5. **Data Volume**
   - < 1 million NFTs → LevelDB
   - > 1 million NFTs → PostgreSQL

## Quick Start

### Using LevelDB (Default)

```typescript
import { JsonRpcProvider } from "ethers";
import { NFTIndexer } from "simple-nft-indexer";

// Initialize provider with HTTP configuration
const provider = new JsonRpcProvider(process.env.RPC_URL, undefined, {
  polling: true,      // Use HTTP polling instead of WebSocket
  staticNetwork: true // Prevent network auto-detection
});

const contractAddress = "0xYourNFTContractAddress";

// Configure indexer with LevelDB
const indexer = new NFTIndexer(contractAddress, provider, {
  dbPath: "./data/nft-indexer", // Path for LevelDB storage
  startBlock: 0,                // Starting block for sync
  batchSize: 2000              // Number of blocks per batch
});

// Initialize and start syncing
await indexer.init();

// Query token data
const owner = await indexer.getTokenOwner("1234");
const metadata = await indexer.getTokenMetadata("1234");

// Clean up when done
await indexer.close();
```

### Using PostgreSQL

First, set up your environment variables:

```bash
# PostgreSQL connection settings
DATABASE_URL=postgres://user:pass@localhost:5432/nft_indexer
DB_TABLE_PREFIX=nft_idx_     # Optional: prefix for table names
DB_MAX_CONNECTIONS=5         # Optional: connection pool size
DB_SSL=false                 # Optional: SSL configuration
```

Then use the PostgreSQL storage:

```typescript
import { JsonRpcProvider } from "ethers";
import { NFTIndexer, Database } from "simple-nft-indexer";

// Initialize database connection
const db = Database.getInstance({
  connectionString: process.env.DATABASE_URL,
  tablePrefix: process.env.DB_TABLE_PREFIX || 'nft_idx_',
  maxConnections: Number(process.env.DB_MAX_CONNECTIONS) || 5,
  ssl: process.env.DB_SSL === 'true'
});

await db.initialize();

// Configure indexer with PostgreSQL
const indexer = new NFTIndexer(contractAddress, provider, {
  database: db,              // Use PostgreSQL instead of LevelDB
  startBlock: 0,            // Starting block for sync
  batchSize: 2000          // Number of blocks per batch
});

// Initialize and start syncing
await indexer.init();

// Query token data (same API as LevelDB)
const owner = await indexer.getTokenOwner("1234");
const metadata = await indexer.getTokenMetadata("1234");

// Clean up
await indexer.close();
await db.disconnect();
```

## Configuration

The indexer can be configured with the following options:

```typescript
const config = {
  startBlock: 0,          // Starting block for historical sync
  batchSize: 1000,        // Number of blocks to process in each batch
  cacheTimeout: 3600000,  // Cache timeout in milliseconds (1 hour)
  maxConcurrent: 3,       // Maximum concurrent requests
  dbPath: "./indexer-db", // Path for LevelDB storage
  pollInterval: 12000     // Block polling interval in milliseconds (12 seconds)
};

const indexer = new NFTIndexer(contractAddress, provider, config);
```

### Configuration Options

| Option | Type | Default | Storage | Description |
|--------|------|---------|---------|-------------|
| startBlock | number | 0 | Both | Block number to start syncing from |
| batchSize | number | 1000 | Both | Number of blocks to process in each batch |
| cacheTimeout | number | 3600000 | Both | Cache timeout in milliseconds |
| maxConcurrent | number | 3 | Both | Maximum concurrent requests |
| pollInterval | number | 12000 | Both | Block polling interval in milliseconds |
| dbPath | string | "./indexer-db" | LevelDB | Path for LevelDB storage |
| database | Database | undefined | PostgreSQL | Database instance for PostgreSQL storage |
| tablePrefix | string | "nft_idx_" | PostgreSQL | Prefix for database table names |
| maxConnections | number | 5 | PostgreSQL | Maximum database connections |
| ssl | boolean | false | PostgreSQL | Enable SSL for database connection |
| dropOnInit | boolean | false | PostgreSQL | Drop and recreate tables on initialization |

## PostgreSQL Integration

The indexer supports PostgreSQL as an alternative to LevelDB for more scalable and flexible data storage. This feature is particularly useful for production deployments and applications requiring complex queries.

### Database Configuration

```typescript
import { NFTIndexer, Database } from "simple-nft-indexer";

// Configure PostgreSQL connection
const dbConfig = {
  connectionString: "postgres://user:pass@localhost:5432/nft_indexer",
  tablePrefix: "nft_idx_",     // Optional prefix for table names
  maxConnections: 10,          // Optional connection pool size
  ssl: false,                  // Optional SSL configuration
  dropOnInit: false           // Optional: drop and recreate tables on initialization
};

// Note: Set dropOnInit to true during development/testing to start fresh
// This will drop and recreate all tables on initialization

// Initialize database
const db = Database.getInstance(dbConfig);
await db.initialize();

// Use database with indexer
const indexer = new NFTIndexer(contractAddress, provider, {
  ...config,
  database: db
});
```

### Database Features

- **Safe Table Creation**: Tables are created automatically with configurable prefixes
- **Connection Pooling**: Efficient connection management for better performance
- **Type Safety**: Full TypeScript support for database operations
- **Flexible Queries**: Support for complex NFT data queries
- **Migration Support**: Built-in database migration system

### Environment Variables

The database configuration supports the following environment variables:

```bash
DATABASE_URL=postgres://user:pass@host:5432/dbname
DB_TABLE_PREFIX=nft_idx_
DB_MAX_CONNECTIONS=10
DB_SSL=false
DB_DROP_ON_INIT=false  # Set to 'true' to drop and recreate tables on initialization
```

### Database Operations

```typescript
// Query NFTs by contract
const nfts = await db.getNFTsByContract("0x...");

// Get specific NFT with metadata
const nft = await db.getNFTByTokenId("0x...", "1");
console.log(JSON.parse(nft.metadata)); // Access stored metadata

// Update NFT data with metadata
await db.upsertNFT({
  contractAddress: "0x...",
  tokenId: "1",
  owner: "0x...",
  metadata: JSON.stringify({
    uri: "https://api.example.com/token/1",
    metadata: { 
      name: "NFT #1",
      description: "An example NFT",
      image: "https://example.com/nft1.png"
    },
    lastUpdated: Date.now()
  }),
  blockNumber: 1000000
});
```

### Metadata Storage

Both storage backends support full metadata storage with automatic caching:

#### LevelDB
- Stores metadata in a separate key-value store
- Automatically caches metadata in memory
- Includes token URI and parsed metadata
- Tracks last update timestamp
- Example structure:
```typescript
{
  tokenId: "1",
  uri: "https://api.example.com/token/1",
  metadata: {
    name: "NFT #1",
    description: "An example NFT",
    image: "https://example.com/nft1.png"
  },
  lastUpdated: 1678234567890
}
```

#### PostgreSQL
- Stores metadata as JSON in the NFTs table
- Same caching mechanism as LevelDB
- Unified storage with ownership data
- Supports complex metadata queries
- Example structure:
```sql
-- NFTs table for storing token data and metadata
CREATE TABLE nft_idx_nfts (
  id SERIAL PRIMARY KEY,
  contract_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  metadata TEXT, -- Stores JSON string of metadata
  last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
  block_number INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Unique composite index on contract_address and token_id
  UNIQUE(contract_address, token_id)
);

-- Sync state table for tracking indexing progress
CREATE TABLE nft_idx_sync_state (
  id SERIAL PRIMARY KEY,
  contract_address TEXT NOT NULL UNIQUE,
  last_synced_block INTEGER NOT NULL,
  last_synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
);
```

## Network Connectivity

The indexer uses HTTP polling for network connectivity, which provides better reliability and compatibility across different RPC providers. When initializing the provider, it's recommended to configure it for HTTP polling:

```typescript
const provider = new JsonRpcProvider(rpcUrl, undefined, {
  polling: true,      // Use HTTP polling instead of WebSocket
  staticNetwork: true // Prevent network auto-detection
});
```

The indexer will automatically poll for new blocks at the configured interval (default: 12 seconds). You can adjust the polling interval through the `pollInterval` configuration option based on your network's average block time.

## API Reference

### Core Methods

#### `init(): Promise<void>`
Initializes the indexer and starts syncing historical data.

#### `getTokenOwner(tokenId: string): Promise<string>`
Gets the current owner of a token.

#### `getTokenMetadata(tokenId: string): Promise<TokenMetadata>`
Gets the metadata for a token.

#### `getTokenTransfers(tokenId: string): Promise<TokenTransfer[]>`
Gets the transfer history for a token.

#### `getOwnerTokens(owner: string): Promise<string[]>`
Gets all tokens owned by an address.

#### `close(): Promise<void>`
Closes the indexer and cleans up resources.

### Event Handling

The indexer emits events that you can subscribe to:

```typescript
// Sync progress events
indexer.on("sync", (progress) => {
  console.log(`Sync progress: ${progress.current}/${progress.target}`);
});

// Transfer events
indexer.on("transfer", (transfer) => {
  console.log(`Transfer: Token ${transfer.tokenId} from ${transfer.from} to ${transfer.to}`);
});

// Error events
indexer.on("error", (error) => {
  console.error("Indexer error:", error);
});
```

## Best Practices

1. **Error Handling**
   - Always wrap indexer operations in try-catch blocks
   - Subscribe to error events for monitoring
   - Implement proper cleanup in finally blocks

```typescript
try {
  await indexer.init();
  // ... your code ...
} catch (error) {
  console.error("Error:", error);
} finally {
  await indexer.close();
}
```

2. **Resource Management**
   - Close the indexer when done to release resources
   - Use appropriate batch sizes for your use case
   - Configure cache timeouts based on your needs

3. **Performance Optimization**
   - Start from an appropriate block number to avoid unnecessary syncing
   - Use caching effectively by setting appropriate timeouts
   - Batch queries when possible to reduce RPC calls
   - Adjust polling interval based on your network's block time

4. **Event Handling**
   - Subscribe to events before calling init()
   - Handle events asynchronously to avoid blocking
   - Implement proper error handling in event callbacks

## Examples

Check out the [examples directory](./src/examples) for more detailed usage examples:

- [Basic Usage](./src/examples/basic-usage.ts): Simple example of indexer initialization and queries
- [Database Usage](./src/examples/database-usage.ts): Example of PostgreSQL integration and database operations
- More examples coming soon...

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.
