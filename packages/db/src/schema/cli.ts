import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sessions, users } from './auth.js';

export const cliDeviceRequests = pgTable(
  'cli_device_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    deviceCodeHash: text().notNull(),
    userCode: text().notNull(),
    clientName: text().notNull(),
    hostname: text(),
    platform: text(),
    ipAddress: text(),
    status: text().notNull().default('pending'),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    scope: jsonb(),
    sessionId: uuid().references(() => sessions.id, { onDelete: 'set null' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cli_device_requests_device_code_unique').on(table.deviceCodeHash),
    index('cli_device_requests_user_code_idx').on(table.userCode),
    index('cli_device_requests_expiry_idx').on(table.expiresAt),
  ],
);
