import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { log } from '../utils/logger';
import { DEFAULT_CONFIG } from './config';

const runMigrations = async () => {
  log.info('Starting database migrations');
  
  // Use the same connection string as our main database config
  const migrationClient = postgres(DEFAULT_CONFIG.connectionString, { 
    max: 1,
    ssl: DEFAULT_CONFIG.ssl
  });
  
  try {
    const db = drizzle(migrationClient);
    
    // This will automatically run needed migrations on the database
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
    
    log.info('Migrations completed successfully');
  } catch (error) {
    log.error('Migration failed', error as Error);
    throw error;
  } finally {
    // Close the migration connection
    await migrationClient.end();
  }
};

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default runMigrations;
