import { pgTable, serial, text, timestamp, integer, boolean, varchar } from 'drizzle-orm/pg-core';
import { DEFAULT_CONFIG } from './config';

const prefix = DEFAULT_CONFIG.tablePrefix;

// NFT table with prefixed name
export const nfts = pgTable(`${prefix}nfts`, {
  id: serial('id').primaryKey(),
  contractAddress: text('contract_address').notNull(),
  tokenId: text('token_id').notNull(),
  owner: text('owner').notNull(),
  metadata: text('metadata'),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  blockNumber: integer('block_number').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

// Create a composite unique index on contract address and token ID
export const nftIndexes = {
  contractTokenId: `${prefix}nfts_contract_token_idx`,
};

// This will be used to create the index in a safe way (if not exists)
// Sync state table to track indexing progress
export const syncState = pgTable(`${prefix}sync_state`, {
  id: serial('id').primaryKey(),
  contractAddress: text('contract_address').notNull(),
  lastSyncedBlock: integer('last_synced_block').notNull(),
  lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
});

// Create a unique index on contract address for sync state
export const syncStateIndex = `
  DO $$ 
  BEGIN 
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = '${prefix}sync_state_contract_idx'
    ) THEN 
      CREATE UNIQUE INDEX ${prefix}sync_state_contract_idx 
      ON ${prefix}sync_state (contract_address);
    END IF;
  END $$;
`;

export const createIndexSQL = `
  DO $$ 
  BEGIN 
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = '${nftIndexes.contractTokenId}'
    ) THEN 
      CREATE UNIQUE INDEX ${nftIndexes.contractTokenId} 
      ON ${prefix}nfts (contract_address, token_id);
    END IF;
  END $$;
`;
