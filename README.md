# Simple NFT Indexer

A lightweight and efficient NFT contract indexer with smart caching and minimal RPC calls. This library helps you track NFT ownership, transfers, and metadata while maintaining a local cache to reduce network requests.

## Features

- 🚀 Efficient historical sync with configurable batch sizes
- 💾 LevelDB-based persistent storage
- 🔄 Smart caching system for ownership and metadata
- 🎯 Minimal RPC calls with optimized data fetching
- 📊 Real-time transfer event monitoring
- 🔍 Comprehensive query methods for token data
- 📝 TypeScript support with full type definitions

## Installation

```bash
# Using pnpm (recommended)
pnpm install simple-nft-indexer

# Using npm
npm install simple-nft-indexer

# Using yarn
yarn add simple-nft-indexer
```

## Quick Start

```typescript
import { JsonRpcProvider } from "ethers";
import { NFTIndexer } from "simple-nft-indexer";

// Initialize provider with HTTP configuration
const provider = new JsonRpcProvider(process.env.RPC_URL, undefined, {
  polling: true,      // Use HTTP polling instead of WebSocket
  staticNetwork: true // Prevent network auto-detection
});

const contractAddress = "0xYourNFTContractAddress";
const indexer = new NFTIndexer(contractAddress, provider);

// Initialize and start syncing
await indexer.init();

// Query token ownership
const owner = await indexer.getTokenOwner("1234");
console.log(`Token owner: ${owner}`);

// Get token metadata
const metadata = await indexer.getTokenMetadata("1234");
console.log("Token metadata:", metadata);

// Clean up when done
await indexer.close();
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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| startBlock | number | 0 | Block number to start syncing from |
| batchSize | number | 1000 | Number of blocks to process in each batch |
| cacheTimeout | number | 3600000 | Cache timeout in milliseconds |
| maxConcurrent | number | 3 | Maximum concurrent requests |
| dbPath | string | "./indexer-db" | Path for LevelDB storage |
| pollInterval | number | 12000 | Block polling interval in milliseconds |

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
- More examples coming soon...

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.
