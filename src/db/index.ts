import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';
import { log } from '../utils/logger';
import { DatabaseConfig, DEFAULT_CONFIG } from './config';

class DatabaseImpl {
  private static instance: DatabaseImpl | null = null;
  private client: postgres.Sql<{}> | null = null;
  private db: ReturnType<typeof drizzle> | null = null;
  private config: DatabaseConfig;

  private constructor(config: DatabaseConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  public static getInstance(config?: DatabaseConfig): DatabaseImpl {
    if (!DatabaseImpl.instance) {
      DatabaseImpl.instance = new DatabaseImpl(config);
    } else if (config) {
      log.warn('Database instance already exists, ignoring new configuration');
    }
    return DatabaseImpl.instance;
  }

  private ensureConnection() {
    if (!this.client || !this.db) {
      this.client = postgres(this.config.connectionString, {
        max: this.config.maxConnections,
        ssl: this.config.ssl,
      });
      this.db = drizzle(this.client, { schema });
    }
  }

  private async dropTables(): Promise<void> {
    try {
      if (!this.db) throw new Error('Database not initialized');
      
      // Drop tables in reverse order of dependencies
      await this.db.execute(sql`
        DROP TABLE IF EXISTS ${sql.identifier(this.config.tablePrefix + 'sync_state')};
        DROP TABLE IF EXISTS ${sql.identifier(this.config.tablePrefix + 'nfts')};
      `);
      
      log.info('Dropped existing tables');
    } catch (error) {
      log.error('Failed to drop tables', error as Error);
      throw error;
    }
  }

  public async initialize(): Promise<void> {
    try {
      this.ensureConnection();
      if (!this.db) throw new Error('Database not initialized');

      // Drop tables if dropOnInit is true
      if (this.config.dropOnInit) {
        await this.dropTables();
      }

      // Create tables if they don't exist
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(this.config.tablePrefix + 'nfts')} (
          id SERIAL PRIMARY KEY,
          contract_address TEXT NOT NULL,
          token_id TEXT NOT NULL,
          owner TEXT NOT NULL,
          metadata TEXT,
          last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
          block_number INTEGER NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE
        );
      `);

      // Create index using the safe creation SQL
      // Create sync state table
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(this.config.tablePrefix + 'sync_state')} (
          id SERIAL PRIMARY KEY,
          contract_address TEXT NOT NULL,
          last_synced_block INTEGER NOT NULL,
          last_synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
          status VARCHAR(20) NOT NULL DEFAULT 'active'
        );
      `);

      // Create indexes
      await this.db.execute(sql.raw(schema.createIndexSQL));
      await this.db.execute(sql.raw(schema.syncStateIndex));
      
      log.info('Database initialized successfully');
    } catch (error) {
      log.error('Failed to initialize database', error as Error);
      throw error;
    }
  }

  public async getLastSyncedBlock(contractAddress: string): Promise<number> {
    try {
      this.ensureConnection();
      if (!this.db) throw new Error('Database not initialized');

      const result = await this.db.select({ lastSyncedBlock: schema.syncState.lastSyncedBlock })
        .from(schema.syncState)
        .where(eq(schema.syncState.contractAddress, contractAddress))
        .limit(1);
      
      return result.length > 0 ? result[0].lastSyncedBlock : 0;
    } catch (error) {
      log.error('Error getting last synced block', error as Error);
      return 0;
    }
  }

  public async updateSyncState(contractAddress: string, blockNumber: number): Promise<void> {
    try {
      this.ensureConnection();
      if (!this.db) throw new Error('Database not initialized');

      await this.db.insert(schema.syncState)
        .values({
          contractAddress,
          lastSyncedBlock: blockNumber,
          lastSyncedAt: new Date(),
          status: 'active'
        })
        .onConflictDoUpdate({
          target: [schema.syncState.contractAddress],
          set: {
            lastSyncedBlock: blockNumber,
            lastSyncedAt: new Date()
          }
        });
    } catch (error) {
      log.error('Error updating sync state', error as Error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.end();
        this.client = null;
        this.db = null;
        log.info('Successfully disconnected from PostgreSQL database');
      }
    } catch (error) {
      log.error('Error disconnecting from PostgreSQL database', error as Error);
      throw error;
    }
  }

  // NFT-related database operations
  public async upsertNFT(nftData: {
    contractAddress: string;
    tokenId: string;
    owner: string;
    metadata?: string;
    blockNumber: number;
  }) {
    try {
      this.ensureConnection();
      if (!this.db) throw new Error('Database not initialized');

      const result = await this.db.insert(schema.nfts).values({
        contractAddress: nftData.contractAddress,
        tokenId: nftData.tokenId,
        owner: nftData.owner,
        metadata: nftData.metadata,
        blockNumber: nftData.blockNumber,
      }).onConflictDoUpdate({
        target: [schema.nfts.contractAddress, schema.nfts.tokenId],
        set: {
          owner: nftData.owner,
          metadata: nftData.metadata,
          blockNumber: nftData.blockNumber,
          lastUpdated: new Date(),
        },
      });
      return result;
    } catch (error) {
      log.error('Error upserting NFT', error as Error);
      throw error;
    }
  }

  public async getNFTsByContract(contractAddress: string) {
    try {
      this.ensureConnection();
      if (!this.db) throw new Error('Database not initialized');

      return await this.db.select()
        .from(schema.nfts)
        .where(sql`${schema.nfts.contractAddress} = ${contractAddress}`);
    } catch (error) {
      log.error('Error getting NFTs by contract', error as Error);
      throw error;
    }
  }

  public async getNFTByTokenId(contractAddress: string, tokenId: string) {
    try {
      this.ensureConnection();
      if (!this.db) throw new Error('Database not initialized');

      const results = await this.db.select()
        .from(schema.nfts)
        .where(sql`${schema.nfts.contractAddress} = ${contractAddress} AND ${schema.nfts.tokenId} = ${tokenId}`);
      return results[0];
    } catch (error) {
      log.error('Error getting NFT by token ID', error as Error);
      throw error;
    }
  }

  public async getTableInfo() {
    try {
      this.ensureConnection();
      if (!this.db) throw new Error('Database not initialized');

      const tableInfo = await this.db.execute(sql`
        SELECT 
          table_name, 
          column_name, 
          data_type 
        FROM 
          information_schema.columns 
        WHERE 
          table_name LIKE ${this.config.tablePrefix + '%'};
      `);
      return tableInfo;
    } catch (error) {
      log.error('Error getting table information', error as Error);
      throw error;
    }
  }
}

// Export type and implementation
export type Database = DatabaseImpl;
export const Database = DatabaseImpl;
