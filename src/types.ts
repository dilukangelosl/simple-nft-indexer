import { BigNumberish } from "ethers";

// Core interfaces for NFT data structures
export interface TokenOwnership {
  tokenId: string;
  owner: string;
  timestamp: number;
}

export interface TokenTransfer {
  tokenId: string;
  from: string;
  to: string;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

export interface TokenMetadata {
  tokenId: string;
  uri: string;
  metadata?: Record<string, any>;
  lastUpdated: number;
}

// Configuration interfaces
export interface IndexerConfig {
  startBlock?: number;
  batchSize?: number;
  cacheTimeout?: number;
  maxConcurrent?: number;
  dbPath?: string;
  pollInterval?: number;
}

export interface CacheConfig {
  ownership: number; // Cache timeout in ms
  metadata: number;
}

// Error types
export enum IndexerErrorType {
  NETWORK_ERROR = "NETWORK_ERROR",
  CONTRACT_ERROR = "CONTRACT_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  INVALID_INPUT = "INVALID_INPUT",
}

export class IndexerError extends Error {
  constructor(
    public type: IndexerErrorType,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = "IndexerError";
  }
}

// Default configurations
export const DEFAULT_CONFIG: IndexerConfig = {
  startBlock: 0,
  batchSize: 1000,
  cacheTimeout: 3600000, // 1 hour
  maxConcurrent: 3,
  dbPath: "./indexer-db",
  pollInterval: 12000 // 12 seconds
};

// Minimal ABI for NFT contract interactions
export const ERC721_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)"
];

// Database key prefixes for different data types
export const DB_PREFIXES = {
  OWNERSHIP: "own:",
  TRANSFER: "transfer:",
  METADATA: "meta:",
  OWNER_TOKENS: "tokens:",
  SYNC_STATE: "sync:"
} as const;

// Event types for indexer events
export interface IndexerEvents {
  sync: (progress: { current: number; target: number }) => void;
  error: (error: IndexerError) => void;
  transfer: (transfer: TokenTransfer) => void;
}
