import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oauthProviderEnum, webauthnChallengeKindEnum } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    passwordHash: text(),
    displayName: text().notNull(),
    avatarColor: text().notNull().default('#7c9cff'),
    avatarUrl: text(),
    totpSecret: text(),
    totpEnabledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text().notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('recovery_codes_user_idx').on(table.userId)],
);

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: oauthProviderEnum().notNull(),
    providerAccountId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('oauth_accounts_provider_unique').on(table.provider, table.providerAccountId),
    index('oauth_accounts_user_idx').on(table.userId),
  ],
);

export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text().notNull(),
    publicKey: text().notNull(),
    counter: integer().notNull().default(0),
    transports: text().array(),
    deviceType: text(),
    backedUp: boolean().notNull().default(false),
    label: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('passkeys_credential_unique').on(table.credentialId),
    index('passkeys_user_idx').on(table.userId),
  ],
);

export const webauthnChallenges = pgTable(
  'webauthn_challenges',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    kind: webauthnChallengeKindEnum().notNull(),
    challenge: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('webauthn_challenges_expiry_idx').on(table.expiresAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text().notNull(),
    deviceName: text().notNull().default('Unknown device'),
    userAgent: text(),
    ipAddress: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text(),
    previousRefreshTokenHash: text(),
    rotatedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sessions_refresh_token_unique').on(table.refreshTokenHash),
    index('sessions_previous_refresh_token_idx').on(table.previousRefreshTokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expiry_idx').on(table.expiresAt),
  ],
);

export const twoFactorChallenges = pgTable(
  'two_factor_challenges',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    deviceName: text(),
    userAgent: text(),
    ipAddress: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('two_factor_challenges_token_unique').on(table.tokenHash)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  passkeys: many(passkeys),
  oauthAccounts: many(oauthAccounts),
  recoveryCodes: many(recoveryCodes),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, { fields: [passkeys.userId], references: [users.id] }),
}));
