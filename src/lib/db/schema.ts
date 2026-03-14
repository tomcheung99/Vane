import { sql } from 'drizzle-orm';
import { text, pgTable, jsonb, serial, integer } from 'drizzle-orm/pg-core';
import { Block } from '../types';
import { SearchSources } from '../agents/search/types';

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  messageId: text('messageId').notNull(),
  chatId: text('chatId').notNull(),
  backendId: text('backendId').notNull(),
  query: text('query').notNull(),
  createdAt: text('createdAt').notNull(),
  responseBlocks: jsonb('responseBlocks')
    .$type<Block[]>()
    .default(sql`'[]'::jsonb`),
  status: text('status', { enum: ['answering', 'completed', 'error'] }).default(
    'answering',
  ),
});

interface DBFile {
  name: string;
  fileId: string;
}

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('createdAt').notNull(),
  sources: jsonb('sources')
    .$type<SearchSources[]>()
    .default(sql`'[]'::jsonb`),
  files: jsonb('files')
    .$type<DBFile[]>()
    .default(sql`'[]'::jsonb`),
});

export const mcpServers = pgTable('mcp_servers', {
  name: text('name').primaryKey(),
  type: text('type').notNull().default('sse'),
  url: text('url').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>(),
  toolTimeout: integer('toolTimeout').default(30),
  createdAt: text('createdAt').notNull(),
});

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: text('id').primaryKey(),
  publicKey: text('publicKey').notNull(),
  counter: integer('counter').notNull().default(0),
  deviceType: text('deviceType'),
  backedUp: text('backedUp').default('false'),
  transports: text('transports'),
  createdAt: text('createdAt').notNull(),
});

export const authSettings = pgTable('auth_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
