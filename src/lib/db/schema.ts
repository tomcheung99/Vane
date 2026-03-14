import { sql } from 'drizzle-orm';
import { text, integer, pgTable, pgSchema, jsonb, serial } from 'drizzle-orm/pg-core';
import { Block } from '../types';
import { SearchSources } from '../agents/search/types';

export const vaneSchema = pgSchema('vane');

export const messages = vaneSchema.table('messages', {
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

export const chats = vaneSchema.table('chats', {
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
