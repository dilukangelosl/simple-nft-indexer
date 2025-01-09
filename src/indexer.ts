import { Contract, JsonRpcProvider, EventLog, Interface } from "ethers";
import { IndexerDB } from "./db";
import { Database } from "./db/index";
import { log } from "./utils/logger";
import {
  IndexerConfig,
  DEFAULT_CONFIG,
  ERC721_ABI,
  TokenTransfer,
  TokenMetadata,
  IndexerError,
  IndexerErrorType,
  IndexerEvents,
} from "./types";

export class NFTIndexer {
  private db: IndexerDB | Database;
  private contract: Contract;
  private config: Required<IndexerConfig>;
  private metadataCache: Map<string, TokenMetadata>;
  private ownershipCache: Map<string, string>;
  private isInitialized: boolean = false;
  private eventHandlers: Partial<IndexerEvents> = {};
  constructor(
    contractAddress: string,
    provider: JsonRpcProvider,
    config: Partial<IndexerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<IndexerConfig>;
    // Use PostgreSQL if provided, otherwise fallback to LevelDB
    this.db = this.config.database || new IndexerDB(this.config.dbPath);
    this.contract = new Contract(contractAddress, ERC721_ABI, provider);
    this.metadataCache = new Map();
    this.ownershipCache = new Map();
  }

  // Initialization and event handling
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize database
      if (this.db instanceof IndexerDB) {
        await this.db.init();
      } else {
        await this.db.initialize();
      }
      await this.syncHistoricalData();
      this.isInitialized = true;
      this.setupEventListeners();
      log.info("NFT Indexer initialized successfully");
    } catch (error) {
      log.error("Failed to initialize NFT Indexer", error as Error);
      throw new IndexerError(
        IndexerErrorType.CONTRACT_ERROR,
        "Initialization failed",
        error as Error
      );
    }
  }

  on<K extends keyof IndexerEvents>(event: K, handler: IndexerEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  private emitEvent<K extends keyof IndexerEvents>(
    event: K,
    ...args: Parameters<IndexerEvents[K]>
  ) {
    const handler = this.eventHandlers[event];
    if (handler) {
      (handler as Function)(...args);
    }
  }

  // Historical data sync
  private async getLastSyncedBlock(): Promise<number> {
    if (this.db instanceof IndexerDB) {
      return await this.db.getLastSyncedBlock();
    }
    // For PostgreSQL, use the dedicated sync_state table
    return await this.db.getLastSyncedBlock(this.contract.target as string);
  }

  private async setSyncState(blockNumber: number): Promise<void> {
    if (this.db instanceof IndexerDB) {
      await this.db.setSyncState(blockNumber);
    } else {
      // For PostgreSQL, update the sync_state table
      await this.db.updateSyncState(this.contract.target as string, blockNumber);
    }
  }

  private async syncHistoricalData(): Promise<void> {
    const lastSynced = await this.getLastSyncedBlock();
    const provider = this.contract.runner as JsonRpcProvider;
    const currentBlock = await provider.getBlockNumber();
    const startBlock = Math.max(this.config.startBlock, lastSynced + 1);

    if (startBlock >= currentBlock) {
      log.info("No historical data to sync");
      return;
    }

    log.info(`Starting historical sync from block ${startBlock} to ${currentBlock}`);

    for (let i = startBlock; i <= currentBlock; i += this.config.batchSize) {
      const endBlock = Math.min(i + this.config.batchSize - 1, currentBlock);
      await this.processBlockRange(i, endBlock);
      await this.setSyncState(endBlock);
      this.emitEvent("sync", { current: endBlock, target: currentBlock });
    }

    log.info("Historical sync completed");
  }

  private async processBlockRange(startBlock: number, endBlock: number, retries = 3): Promise<void> {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const timeout = (promise: Promise<any>, ms: number) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
        )
      ]);
    };
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        log.info(`Querying events for blocks ${startBlock}-${endBlock}`);
        
        // Add 30 second timeout for RPC query
        const events = await timeout(
          this.contract.queryFilter(
            this.contract.filters.Transfer(),
            startBlock,
            endBlock
          ),
          30000 // 30 seconds
        );
        
        log.info(`Found ${events.length} events in blocks ${startBlock}-${endBlock}`);

        // Process events in batches of 20
        const batchSize = 20;
        for (let i = 0; i < events.length; i += batchSize) {
          const batch = events.slice(i, i + batchSize);
          const batchStart = i + 1;
          const batchEnd = Math.min(i + batchSize, events.length);
          log.info(`Processing events ${batchStart}-${batchEnd} of ${events.length} (${((batchEnd/events.length)*100).toFixed(1)}%)`);
          
          // Process events sequentially to avoid overwhelming the RPC
          for (const event of batch) {
            try {
              await this.processTransferEvent(event as EventLog);
            } catch (error) {
              log.error(`Failed to process event in block ${event.blockNumber}`, error as Error);
            }
            // Small delay between events
            await delay(50);
          }
          
          log.info(`Completed batch ${batchStart}-${batchEnd}`);
          
          // Larger delay between batches
          if (i + batchSize < events.length) {
            await delay(500);
          }
        }
        return; // Success, exit retry loop
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (attempt === retries) {
          log.error(`RPC Error: Failed to process block range ${startBlock}-${endBlock} after ${retries} attempts. Error: ${errorMessage}. Block range: ${startBlock}-${endBlock}`);
          throw new IndexerError(
            IndexerErrorType.NETWORK_ERROR,
            `Failed to process block range ${startBlock}-${endBlock} after ${retries} attempts`,
            error as Error
          );
        }
        
        // Log retry attempt with error details
        const backoffMs = Math.min(2 ** attempt * 1000, 10000);
        log.warn(`RPC Error: Retry ${attempt}/${retries} for block range ${startBlock}-${endBlock}. Error: ${errorMessage}. Next retry in ${backoffMs}ms`);
        
        // If we get a timeout error, reduce the block range for the next attempt
        if (errorMessage.includes('timed out')) {
          const midPoint = Math.floor((endBlock - startBlock) / 2) + startBlock;
          log.info(`Timeout occurred, splitting block range into ${startBlock}-${midPoint} and ${midPoint + 1}-${endBlock}`);
          await this.processBlockRange(startBlock, midPoint, retries);
          await this.processBlockRange(midPoint + 1, endBlock, retries);
          return;
        }
        
        // Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s)
        const backoff = Math.min(2 ** attempt * 1000, 10000);
        await delay(backoff);
      }
    }
  }

  // Block monitoring
  private async setupEventListeners(): Promise<void> {
    if (!this.isInitialized) {
      throw new IndexerError(
        IndexerErrorType.INVALID_INPUT,
        "Indexer must be initialized before starting block monitoring"
      );
    }

    const provider = this.contract.runner as JsonRpcProvider;
    let lastProcessedBlock = await this.getLastSyncedBlock();

    // Set up polling for new blocks
    const pollNewBlocks = async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        if (currentBlock > lastProcessedBlock) {
          log.info(`Processing new blocks from ${lastProcessedBlock + 1} to ${currentBlock}`);
          await this.processBlockRange(lastProcessedBlock + 1, currentBlock);
          await this.setSyncState(currentBlock);
          lastProcessedBlock = currentBlock;
          this.emitEvent("sync", { current: currentBlock, target: currentBlock });
        }
      } catch (error) {
        log.error("Failed to process new block", error as Error);
      }
    };

    // Poll every 12 seconds (average block time)
    const pollInterval = setInterval(pollNewBlocks, 12000);

    // Clean up on process exit
    process.on('SIGINT', () => {
      clearInterval(pollInterval);
      this.close();
    });

    log.info("Block monitoring started successfully");
  }

  private async processTransferEvent(event: EventLog): Promise<void> {
    const startTime = Date.now();
    try {
      if (!event.args || event.args.length < 3) {
        throw new Error('Invalid event arguments');
      }
      const [from, to, tokenId] = event.args;
      log.info(`Processing transfer of token ${tokenId} from ${from} to ${to} in block ${event.blockNumber}`);
      
      const transfer: TokenTransfer = {
        tokenId: tokenId.toString(),
        from,
        to,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        timestamp: Date.now(),
      };

      // Store transfer without metadata first
      if (this.db instanceof IndexerDB) {
        await this.db.addTransfer(transfer);
        await this.db.setTokenOwner(transfer.tokenId, to, transfer.timestamp);
      } else {
        // For PostgreSQL, store transfer data first
        await this.db.upsertNFT({
          contractAddress: this.contract.target as string,
          tokenId: transfer.tokenId,
          owner: transfer.to,
          blockNumber: transfer.blockNumber,
          metadata: undefined // Skip metadata initially
        });
      }
      
      this.ownershipCache.set(transfer.tokenId, to);
      this.emitEvent("transfer", transfer);
      log.transferEvent(transfer.tokenId, from, to, event.blockNumber);
      
      // Fetch metadata asynchronously with timeout
      setTimeout(async () => {
        try {
          const tokenMetadata = await Promise.race([
            this.getTokenMetadata(transfer.tokenId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Metadata fetch timeout')), 5000))
          ]);
          
          // Update stored NFT with metadata
          if (!(this.db instanceof IndexerDB)) {
            await this.db.upsertNFT({
              contractAddress: this.contract.target as string,
              tokenId: transfer.tokenId,
              owner: transfer.to,
              blockNumber: transfer.blockNumber,
              metadata: JSON.stringify(tokenMetadata)
            });
          }
          log.info(`Updated metadata for token ${tokenId}`);
        } catch (error) {
          log.warn(`Skipping metadata fetch for token ${tokenId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, 0);
      
    } catch (error) {
      log.error(`Failed to process transfer event in block ${event.blockNumber}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      log.rpcCall("processTransferEvent", Date.now() - startTime);
    }
  }

  // Query methods
  async getTokenOwner(tokenId: string): Promise<string> {
    // Check cache first
    if (this.ownershipCache.has(tokenId)) {
      return this.ownershipCache.get(tokenId)!;
    }

    // Check database
    const ownership = this.db instanceof IndexerDB ? 
      await this.db.getTokenOwner(tokenId) :
      await this.db.getNFTByTokenId(this.contract.target as string, tokenId);
    if (ownership) {
      this.ownershipCache.set(tokenId, ownership.owner);
      return ownership.owner;
    }

    // Fallback to contract call
    try {
      const startTime = Date.now();
      const owner = await this.contract.ownerOf(tokenId);
      log.rpcCall("ownerOf", Date.now() - startTime);
      
      if (this.db instanceof IndexerDB) {
        await this.db.setTokenOwner(tokenId, owner, Date.now());
      } else {
        // Fetch metadata when setting owner
        let metadata: string | undefined;
        try {
          const tokenMetadata = await this.getTokenMetadata(tokenId);
          metadata = JSON.stringify(tokenMetadata);
        } catch (error) {
          log.error(`Failed to fetch metadata for token ${tokenId}`, error as Error);
        }

        await this.db.upsertNFT({
          contractAddress: this.contract.target as string,
          tokenId,
          owner,
          blockNumber: await this.getLastSyncedBlock(),
          metadata: metadata
        });
      }
      this.ownershipCache.set(tokenId, owner);
      return owner;
    } catch (error) {
      throw new IndexerError(
        IndexerErrorType.CONTRACT_ERROR,
        `Failed to get owner of token ${tokenId}`,
        error as Error
      );
    }
  }

  async getTokenMetadata(tokenId: string): Promise<TokenMetadata> {
    // Check cache first
    const cached = this.metadataCache.get(tokenId);
    if (cached && Date.now() - cached.lastUpdated < this.config.cacheTimeout) {
      return cached;
    }

    // Check database
    if (this.db instanceof IndexerDB) {
      const stored = await this.db.getTokenMetadata(tokenId);
      if (stored && Date.now() - stored.lastUpdated < this.config.cacheTimeout) {
        this.metadataCache.set(tokenId, stored);
        return stored;
      }
    } else {
      const stored = await this.db.getNFTByTokenId(this.contract.target as string, tokenId);
      if (stored?.metadata) {
        try {
          const parsedMetadata = JSON.parse(stored.metadata);
          const tokenMetadata: TokenMetadata = {
            tokenId,
            uri: parsedMetadata.uri || '',
            metadata: parsedMetadata.metadata,
            lastUpdated: stored.lastUpdated.getTime()
          };
          if (Date.now() - tokenMetadata.lastUpdated < this.config.cacheTimeout) {
            this.metadataCache.set(tokenId, tokenMetadata);
            return tokenMetadata;
          }
        } catch (error) {
          log.error('Failed to parse stored metadata', error as Error);
        }
      }
    }

    // Fetch from contract
    try {
      const startTime = Date.now();
      const uri = await this.contract.tokenURI(tokenId);
      log.rpcCall("tokenURI", Date.now() - startTime);

      const metadata: TokenMetadata = {
        tokenId,
        uri,
        lastUpdated: Date.now(),
      };

      // Fetch and parse metadata if it's a valid URL
      if (uri.startsWith("http")) {
        const response = await fetch(uri);
        const jsonData = await response.json();
        metadata.metadata = jsonData as Record<string, any>;
      }

      if (this.db instanceof IndexerDB) {
        await this.db.setTokenMetadata(tokenId, metadata);
      } else {
        await this.db.upsertNFT({
          contractAddress: this.contract.target as string,
          tokenId,
          owner: await this.getTokenOwner(tokenId),
          blockNumber: await this.getLastSyncedBlock(),
          metadata: JSON.stringify(metadata)
        });
      }
      this.metadataCache.set(tokenId, metadata);
      log.metadataUpdate(tokenId, true);
      return metadata;
    } catch (error) {
      log.metadataUpdate(tokenId, false, error as Error);
      throw new IndexerError(
        IndexerErrorType.CONTRACT_ERROR,
        `Failed to get metadata for token ${tokenId}`,
        error as Error
      );
    }
  }

  async getTokenTransfers(tokenId: string): Promise<TokenTransfer[]> {
    if (this.db instanceof IndexerDB) {
      return this.db.getTokenTransfers(tokenId);
    }
    // For PostgreSQL, we don't store transfer history
    return [];
  }

  async getOwnerTokens(owner: string): Promise<string[]> {
    if (this.db instanceof IndexerDB) {
      return this.db.getOwnerTokens(owner);
    }
    // For PostgreSQL, query NFTs by owner
    const nfts = await this.db.getNFTsByContract(this.contract.target as string);
    return nfts.filter(nft => nft.owner === owner).map(nft => nft.tokenId);
  }

  async getOwnerTokensFull(owner: string): Promise<any[]> {
    if (this.db instanceof IndexerDB) {
      // For LevelDB, we don't have full records
      const tokenIds = await this.db.getOwnerTokens(owner);
      return tokenIds.map(tokenId => ({ tokenId, owner }));
    }
    // For PostgreSQL, return full NFT records
    const nfts = await this.db.getNFTsByContract(this.contract.target as string);
    return nfts.filter(nft => nft.owner === owner);
  }

  // Cleanup
  async close(): Promise<void> {
    if (this.db instanceof IndexerDB) {
      await this.db.close();
    } else {
      await this.db.disconnect();
    }
    this.metadataCache.clear();
    this.ownershipCache.clear();
    log.info("NFT Indexer closed");
  }
}
