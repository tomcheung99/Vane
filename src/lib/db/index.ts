import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=vane',
});

const db = drizzle(pool, {
  schema: schema,
});

export default db;
