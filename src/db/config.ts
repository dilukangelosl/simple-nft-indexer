export interface DatabaseConfig {
  /**
   * Database connection string
   * Format: postgres://user:password@host:port/database
   */
  connectionString: string;
  
  /**
   * Optional prefix for table names to avoid conflicts
   * Example: "nft_" will create tables like "nft_tokens", "nft_metadata", etc.
   */
  tablePrefix?: string;
  
  /**
   * Maximum number of concurrent connections
   * Default: 10
   */
  maxConnections?: number;
  
  /**
   * SSL configuration
   * Default: false
   */
  ssl?: boolean;

  /**
   * Drop existing tables and start fresh on initialization
   * Default: false
   */
  dropOnInit?: boolean;
}

export const DEFAULT_CONFIG: DatabaseConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres',
  tablePrefix: process.env.DB_TABLE_PREFIX || 'nft_idx_',
  maxConnections: Number(process.env.DB_MAX_CONNECTIONS) || 10,
  ssl: process.env.DB_SSL === 'true',
  dropOnInit: process.env.DB_DROP_ON_INIT === 'true',
};
