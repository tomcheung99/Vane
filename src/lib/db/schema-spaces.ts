// src/lib/db/schema-spaces.ts
// Space System Schema Extension

import { sql } from 'drizzle-orm';
import { text, pgTable, serial, index, boolean } from 'drizzle-orm/pg-core';

// Spaces table - for organizing related chats
export const spaces = pgTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    notes: text('notes').default(''),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  (table) => ({
    updatedAtIdx: index('idx_spaces_updatedat').on(table.updatedAt),
  }),
);

// Extend chats table with space relationship
// NOTE: This requires a migration to add columns to existing chats table:
// - spaceId: text, nullable, references spaces.id
// - isArchived: boolean, default false
