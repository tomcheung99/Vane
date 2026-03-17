import { sql } from 'drizzle-orm';
import { text, pgTable, jsonb, serial, integer, index } from 'drizzle-orm/pg-core';
import { Block } from '../types';
import { SearchSources } from '../agents/search/types';
import type { Model } from '../models/types';

export const spaces = pgTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').default(''),
    emoji: text('emoji').default('📁'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_spaces_createdat').on(table.createdAt),
  }),
);

export const spaceNotes = pgTable(
  'space_notes',
  {
    id: text('id').primaryKey(),
    spaceId: text('spaceId')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    content: text('content').default(''),
    updatedAt: text('updatedAt').notNull(),
  },
  (table) => ({
    spaceIdIdx: index('idx_space_notes_spaceid').on(table.spaceId),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    messageId: text('messageId').notNull(),
    chatId: text('chatId').notNull(),
    backendId: text('backendId').notNull(),
    query: text('query').notNull(),
    createdAt: text('createdAt').notNull(),
    responseBlocks: jsonb('responseBlocks')
      .$type<Block[]>()
      .default(sql`'[]'::jsonb`),
    status: text('status', {
      enum: ['answering', 'completed', 'error'],
    }).default('answering'),
  },
  (table) => ({
    chatIdIdx: index('idx_messages_chatid').on(table.chatId),
    chatIdMessageIdIdx: index('idx_messages_chatid_messageid').on(
      table.chatId,
      table.messageId,
    ),
    chatIdIdIdx: index('idx_messages_chatid_id').on(table.chatId, table.id),
  }),
);

interface DBFile {
  name: string;
  fileId: string;
}

export const chats = pgTable(
  'chats',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    createdAt: text('createdAt').notNull(),
    spaceId: text('spaceId').references(() => spaces.id, { onDelete: 'set null' }),
    sources: jsonb('sources')
      .$type<SearchSources[]>()
      .default(sql`'[]'::jsonb`),
    files: jsonb('files')
      .$type<DBFile[]>()
      .default(sql`'[]'::jsonb`),
  },
  (table) => ({
    createdAtIdIdx: index('idx_chats_createdat_id').on(table.createdAt, table.id),
    spaceIdIdx: index('idx_chats_spaceid').on(table.spaceId),
  }),
);

export const mcpServers = pgTable('mcp_servers', {
  name: text('name').primaryKey(),
  type: text('type').notNull().default('sse'),
  url: text('url').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>(),
  toolTimeout: integer('toolTimeout').default(30),
  createdAt: text('createdAt').notNull(),
});

export const modelProviders = pgTable('model_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  chatModels: jsonb('chatModels')
    .$type<Model[]>()
    .default(sql`'[]'::jsonb`),
  embeddingModels: jsonb('embeddingModels')
    .$type<Model[]>()
    .default(sql`'[]'::jsonb`),
  hash: text('hash').notNull(),
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
