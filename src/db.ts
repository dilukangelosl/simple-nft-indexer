import { Level } from "level";
import {
  TokenOwnership,
  TokenTransfer,
  TokenMetadata,
  DB_PREFIXES,
  IndexerError,
  IndexerErrorType,
} from "./types";

export class IndexerDB {
  private db: Level<string, string>;

  constructor(dbPath: string) {
    this.db = new Level(dbPath);
  }

  // Initialize database
  async init(): Promise<void> {
    try {
      await this.db.open();
    } catch (error) {
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        "Failed to initialize database",
        error as Error
      );
    }
  }

  // Close database connection
  async close(): Promise<void> {
    await this.db.close();
  }

  // Token ownership methods
  async setTokenOwner(tokenId: string, owner: string, timestamp: number): Promise<void> {
    const ownership: TokenOwnership = { tokenId, owner, timestamp };
    await this.db.put(`${DB_PREFIXES.OWNERSHIP}${tokenId}`, JSON.stringify(ownership));
    await this.addTokenToOwner(owner, tokenId);
  }

  async getTokenOwner(tokenId: string): Promise<TokenOwnership | null> {
    try {
      const data = await this.db.get(`${DB_PREFIXES.OWNERSHIP}${tokenId}`);
      return JSON.parse(data) as TokenOwnership;
    } catch (error: any) {
      if (error.notFound) return null;
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        `Failed to get token owner for ${tokenId}`,
        error
      );
    }
  }

  // Token transfer history methods
  async addTransfer(transfer: TokenTransfer): Promise<void> {
    const key = `${DB_PREFIXES.TRANSFER}${transfer.tokenId}:${transfer.blockNumber}:${transfer.transactionHash}`;
    await this.db.put(key, JSON.stringify(transfer));
  }

  async getTokenTransfers(tokenId: string): Promise<TokenTransfer[]> {
    const transfers: TokenTransfer[] = [];
    try {
      for await (const [_, value] of this.db.iterator({
        gte: `${DB_PREFIXES.TRANSFER}${tokenId}:`,
        lte: `${DB_PREFIXES.TRANSFER}${tokenId}:\xff`,
      })) {
        transfers.push(JSON.parse(value) as TokenTransfer);
      }
      return transfers.sort((a, b) => b.blockNumber - a.blockNumber);
    } catch (error) {
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        `Failed to get transfers for token ${tokenId}`,
        error as Error
      );
    }
  }

  // Token metadata methods
  async setTokenMetadata(tokenId: string, metadata: TokenMetadata): Promise<void> {
    await this.db.put(`${DB_PREFIXES.METADATA}${tokenId}`, JSON.stringify(metadata));
  }

  async getTokenMetadata(tokenId: string): Promise<TokenMetadata | null> {
    try {
      const data = await this.db.get(`${DB_PREFIXES.METADATA}${tokenId}`);
      return JSON.parse(data) as TokenMetadata;
    } catch (error: any) {
      if (error.notFound) return null;
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        `Failed to get metadata for token ${tokenId}`,
        error
      );
    }
  }

  // Owner token mapping methods
  private async addTokenToOwner(owner: string, tokenId: string): Promise<void> {
    try {
      const key = `${DB_PREFIXES.OWNER_TOKENS}${owner}`;
      let tokens: string[] = [];
      try {
        const data = await this.db.get(key);
        tokens = JSON.parse(data) as string[];
      } catch (error: any) {
        if (!error.notFound) throw error;
      }
      if (!tokens.includes(tokenId)) {
        tokens.push(tokenId);
        await this.db.put(key, JSON.stringify(tokens));
      }
    } catch (error) {
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        `Failed to add token ${tokenId} to owner ${owner}`,
        error as Error
      );
    }
  }

  async getOwnerTokens(owner: string): Promise<string[]> {
    try {
      const data = await this.db.get(`${DB_PREFIXES.OWNER_TOKENS}${owner}`);
      return JSON.parse(data) as string[];
    } catch (error: any) {
      if (error.notFound) return [];
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        `Failed to get tokens for owner ${owner}`,
        error
      );
    }
  }

  // Sync state methods
  async setSyncState(blockNumber: number): Promise<void> {
    await this.db.put(`${DB_PREFIXES.SYNC_STATE}last`, blockNumber.toString());
  }

  async getLastSyncedBlock(): Promise<number> {
    try {
      const data = await this.db.get(`${DB_PREFIXES.SYNC_STATE}last`);
      return parseInt(data, 10);
    } catch (error: any) {
      if (error.notFound) return 0;
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        "Failed to get last synced block",
        error
      );
    }
  }

  // Batch operations
  async batch(operations: Array<{ type: "put" | "del"; key: string; value?: any }>): Promise<void> {
    try {
      const batch = this.db.batch();
      
      for (const op of operations) {
        if (op.type === "del") {
          batch.del(op.key);
        } else {
          const value = typeof op.value === "string" ? op.value : JSON.stringify(op.value);
          batch.put(op.key, value);
        }
      }
      
      await batch.write();
    } catch (error) {
      throw new IndexerError(
        IndexerErrorType.DATABASE_ERROR,
        "Failed to execute batch operation",
        error as Error
      );
    }
  }
}
