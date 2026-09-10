import { relations, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { workspaces } from './workspaces.js';
import { accessRoleEnum } from './enums.js';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const documents = pgTable(
  'documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: uuid().references((): AnyPgColumn => documents.id, { onDelete: 'cascade' }),
    title: text().notNull().default('Untitled'),
    slug: text().notNull(),
    icon: text(),
    position: integer().notNull().default(0),
    isFolder: boolean().notNull().default(false),
    createdById: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    titleVector: tsvector().generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(${documents.title}, ''))`,
    ),
  },
  (table) => [
    index('documents_workspace_idx').on(table.workspaceId),
    index('documents_parent_idx').on(table.parentId),
    index('documents_title_search_idx').using('gin', table.titleVector),
    uniqueIndex('documents_workspace_slug_unique').on(table.workspaceId, table.slug),
  ],
);

export const documentStates = pgTable(
  'document_states',
  {
    documentId: uuid()
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    state: bytea().notNull(),
    markdown: text().notNull().default(''),
    clock: bigint({ mode: 'number' }).notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp({ withTimezone: true }),
    searchVector: tsvector().generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(${documentStates.markdown}, ''))`,
    ),
  },
  (table) => [index('document_states_search_idx').using('gin', table.searchVector)],
);

export const documentPermissions = pgTable(
  'document_permissions',
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: accessRoleEnum().notNull().default('viewer'),
    grantedById: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('document_permissions_unique').on(table.documentId, table.userId),
    index('document_permissions_user_idx').on(table.userId),
  ],
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    token: text().notNull(),
    documentId: uuid().references(() => documents.id, { onDelete: 'cascade' }),
    workspaceId: uuid().references(() => workspaces.id, { onDelete: 'cascade' }),
    role: accessRoleEnum().notNull().default('viewer'),
    passwordHash: text(),
    expiresAt: timestamp({ withTimezone: true }),
    createdById: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('share_links_token_unique').on(table.token),
    index('share_links_document_idx').on(table.documentId),
    index('share_links_workspace_idx').on(table.workspaceId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    parentId: uuid().references((): AnyPgColumn => comments.id, { onDelete: 'cascade' }),
    anchorId: text().notNull(),
    quotedText: text(),
    body: text().notNull(),
    authorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    resolved: boolean().notNull().default(false),
    resolvedById: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('comments_document_idx').on(table.documentId),
    index('comments_anchor_idx').on(table.documentId, table.anchorId),
    index('comments_parent_idx').on(table.parentId),
  ],
);

export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    commitOid: text().notNull(),
    message: text().notNull(),
    authorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('document_revisions_document_idx').on(table.documentId, table.createdAt),
    uniqueIndex('document_revisions_oid_unique').on(table.documentId, table.commitOid),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    uploaderId: uuid().references(() => users.id, { onDelete: 'set null' }),
    filename: text().notNull(),
    mimeType: text().notNull(),
    byteSize: integer().notNull(),
    storageKey: text().notNull(),
    width: integer(),
    height: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assets_storage_key_unique').on(table.storageKey),
    index('assets_workspace_idx').on(table.workspaceId),
  ],
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [documents.workspaceId], references: [workspaces.id] }),
  parent: one(documents, { fields: [documents.parentId], references: [documents.id] }),
  children: many(documents),
  permissions: many(documentPermissions),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  document: one(documents, { fields: [comments.documentId], references: [documents.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  parent: one(comments, { fields: [comments.parentId], references: [comments.id] }),
  replies: many(comments),
}));
