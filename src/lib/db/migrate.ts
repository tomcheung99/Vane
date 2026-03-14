import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();
  try {
    // Ensure the vane schema exists
    await client.query('CREATE SCHEMA IF NOT EXISTS vane');

    // Create migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS vane.ran_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        run_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Check if tables already exist
    const already = await client.query(
      "SELECT 1 FROM vane.ran_migrations WHERE name = $1",
      ['0003']
    );

    if (already.rowCount && already.rowCount > 0) {
      console.log('Skipping already-applied migration: 0003_pg_init');
      return;
    }

    // Create tables fresh for PostgreSQL
    await client.query(`
      CREATE TABLE IF NOT EXISTS vane.chats (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        sources JSONB DEFAULT '[]'::jsonb,
        files JSONB DEFAULT '[]'::jsonb
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vane.messages (
        id SERIAL PRIMARY KEY,
        "messageId" TEXT NOT NULL,
        "chatId" TEXT NOT NULL,
        "backendId" TEXT NOT NULL,
        query TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "responseBlocks" JSONB DEFAULT '[]'::jsonb,
        status TEXT DEFAULT 'answering'
      );
    `);

    await client.query(
      "INSERT INTO vane.ran_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
      ['0003']
    );
    console.log('Applied migration: 0003_pg_init');
  } catch (err) {
    console.error('Failed to apply PostgreSQL migration:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function migrateMcpServers() {
  const client = await pool.connect();
  try {
    const already = await client.query(
      "SELECT 1 FROM vane.ran_migrations WHERE name = $1",
      ['0004']
    );

    if (already.rowCount && already.rowCount > 0) {
      console.log('Skipping already-applied migration: 0004_mcp_servers');
      return;
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS vane.mcp_servers (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'sse',
        url TEXT NOT NULL,
        headers JSONB,
        "toolTimeout" INTEGER DEFAULT 30,
        "createdAt" TEXT NOT NULL
      );
    `);

    await client.query(
      "INSERT INTO vane.ran_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
      ['0004']
    );
    console.log('Applied migration: 0004_mcp_servers');
  } catch (err) {
    console.error('Failed to apply migration 0004_mcp_servers:', err);
    throw err;
  } finally {
    client.release();
  }
}

await migrate();
await migrateMcpServers();
await pool.end();
