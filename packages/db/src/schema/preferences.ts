import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { documents } from './documents.js';
import { workspaces } from './workspaces.js';

export const userPreferences = pgTable('user_preferences', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastWorkspaceId: uuid().references(() => workspaces.id, { onDelete: 'set null' }),
  lastDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
