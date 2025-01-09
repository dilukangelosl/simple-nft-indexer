import type { Config } from 'drizzle-kit';

// Parse default connection string
const defaultUrl = new URL('postgres://postgres:postgres@localhost:5432/postgres');

export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: defaultUrl.hostname,
    port: Number(defaultUrl.port),
    user: defaultUrl.username,
    password: defaultUrl.password,
    database: defaultUrl.pathname.slice(1),
  },
  strict: true,
} satisfies Config;
