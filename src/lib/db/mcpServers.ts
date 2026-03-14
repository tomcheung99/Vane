import db from './index';
import { mcpServers } from './schema';
import { eq } from 'drizzle-orm';
import type { McpServerEntry } from '../config/types';

export async function getAllMcpServers(): Promise<Record<string, McpServerEntry>> {
  const rows = await db.select().from(mcpServers);
  const result: Record<string, McpServerEntry> = {};
  for (const row of rows) {
    result[row.name] = {
      type: row.type as 'sse',
      url: row.url,
      ...(row.headers ? { headers: row.headers } : {}),
      ...(row.toolTimeout != null ? { toolTimeout: row.toolTimeout } : {}),
    };
  }
  return result;
}

export async function upsertMcpServer(name: string, entry: McpServerEntry): Promise<void> {
  await db.insert(mcpServers)
    .values({
      name,
      type: entry.type,
      url: entry.url,
      headers: entry.headers || null,
      toolTimeout: entry.toolTimeout ?? 30,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: mcpServers.name,
      set: {
        type: entry.type,
        url: entry.url,
        headers: entry.headers || null,
        toolTimeout: entry.toolTimeout ?? 30,
      },
    });
}

export async function deleteMcpServer(name: string): Promise<void> {
  await db.delete(mcpServers).where(eq(mcpServers.name, name));
}

/**
 * Replace all MCP servers in DB with the given set.
 * Deletes servers not present in the new config.
 */
export async function syncAllMcpServersToDb(servers: Record<string, McpServerEntry>): Promise<void> {
  const existing = await getAllMcpServers();

  for (const name of Object.keys(existing)) {
    if (!servers[name]) {
      await deleteMcpServer(name);
    }
  }

  for (const [name, entry] of Object.entries(servers)) {
    await upsertMcpServer(name, entry);
  }
}

/**
 * One-time seed: copies MCP servers from config.json into the DB
 * if the DB has no MCP server records yet.
 */
export async function seedMcpServersFromConfig(): Promise<void> {
  const existing = await getAllMcpServers();
  if (Object.keys(existing).length > 0) return;

  const configManager = (await import('../config/index')).default;
  const configServers = configManager.getMcpServers();

  for (const [name, entry] of Object.entries(configServers)) {
    await upsertMcpServer(name, entry);
  }

  if (Object.keys(configServers).length > 0) {
    console.log(
      `[MCP] Seeded ${Object.keys(configServers).length} MCP server(s) from config.json to database`,
    );
  }
}
