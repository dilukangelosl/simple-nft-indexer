import { Contract, JsonRpcProvider, EventLog, Interface } from "ethers";
import { IndexerDB } from "./db";
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
  private db: IndexerDB;
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
    this.db = new IndexerDB(this.config.dbPath);
    this.contract = new Contract(contractAddress, ERC721_ABI, provider);
    this.metadataCache = new Map();
    this.ownershipCache = new Map();
  }

  // Initialization and event handling
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.db.init();
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
  private async syncHistoricalData(): Promise<void> {
    const lastSynced = await this.db.getLastSyncedBlock();
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
      await this.db.setSyncState(endBlock);
      this.emitEvent("sync", { current: endBlock, target: currentBlock });
    }

    log.info("Historical sync completed");
  }

  private async processBlockRange(startBlock: number, endBlock: number): Promise<void> {
    try {
      const events = await this.contract.queryFilter(
        this.contract.filters.Transfer(),
        startBlock,
        endBlock
      );

      for (const event of events) {
        await this.processTransferEvent(event as EventLog);
      }
    } catch (error) {
      throw new IndexerError(
        IndexerErrorType.NETWORK_ERROR,
        `Failed to process block range ${startBlock}-${endBlock}`,
        error as Error
      );
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
    let lastProcessedBlock = await this.db.getLastSyncedBlock();

    // Set up polling for new blocks
    const pollNewBlocks = async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        if (currentBlock > lastProcessedBlock) {
          log.info(`Processing new blocks from ${lastProcessedBlock + 1} to ${currentBlock}`);
          await this.processBlockRange(lastProcessedBlock + 1, currentBlock);
          await this.db.setSyncState(currentBlock);
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
      const transfer: TokenTransfer = {
        tokenId: tokenId.toString(),
        from,
        to,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        timestamp: Date.now(),
      };

      await this.db.addTransfer(transfer);
      await this.db.setTokenOwner(transfer.tokenId, to, transfer.timestamp);
      this.ownershipCache.set(transfer.tokenId, to);

      this.emitEvent("transfer", transfer);
      log.transferEvent(transfer.tokenId, from, to, event.blockNumber);
    } catch (error) {
      log.error("Failed to process transfer event", error as Error);
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
    const ownership = await this.db.getTokenOwner(tokenId);
    if (ownership) {
      this.ownershipCache.set(tokenId, ownership.owner);
      return ownership.owner;
    }

    // Fallback to contract call
    try {
      const startTime = Date.now();
      const owner = await this.contract.ownerOf(tokenId);
      log.rpcCall("ownerOf", Date.now() - startTime);
      
      await this.db.setTokenOwner(tokenId, owner, Date.now());
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
    const stored = await this.db.getTokenMetadata(tokenId);
    if (stored && Date.now() - stored.lastUpdated < this.config.cacheTimeout) {
      this.metadataCache.set(tokenId, stored);
      return stored;
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

      await this.db.setTokenMetadata(tokenId, metadata);
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
    return this.db.getTokenTransfers(tokenId);
  }

  async getOwnerTokens(owner: string): Promise<string[]> {
    return this.db.getOwnerTokens(owner);
  }

  // Cleanup
  async close(): Promise<void> {
    await this.db.close();
    this.metadataCache.clear();
    this.ownershipCache.clear();
    log.info("NFT Indexer closed");
  }
}
