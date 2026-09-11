import { and, asc, eq, isNull, schema, sql, type Database } from '@collaby/db';
import { resolveWorkspaceAccess } from '../access/resolve.js';

export interface Landing {
  workspaceId: string | null;
  documentId: string | null;
}

async function firstPage(db: Database, workspaceId: string): Promise<string | null> {
  const [page] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.workspaceId, workspaceId),
        eq(schema.documents.isFolder, false),
        isNull(schema.documents.deletedAt),
      ),
    )
    .orderBy(
      sql`${schema.documents.parentId} IS NOT NULL`,
      asc(schema.documents.position),
      asc(schema.documents.createdAt),
    )
    .limit(1);

  return page?.id ?? null;
}

async function openablePageIn(
  db: Database,
  workspaceId: string,
  documentId: string,
): Promise<boolean> {
  const [page] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.workspaceId, workspaceId),
        eq(schema.documents.isFolder, false),
        isNull(schema.documents.deletedAt),
      ),
    )
    .limit(1);

  return Boolean(page);
}

async function fallbackWorkspace(db: Database, userId: string): Promise<string | null> {
  const [personal] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.ownerId, userId), eq(schema.workspaces.kind, 'personal')))
    .limit(1);

  if (personal) return personal.id;

  const [membership] = await db
    .select({ id: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaceMembers.createdAt))
    .limit(1);

  return membership?.id ?? null;
}

export async function resolveLanding(db: Database, userId: string): Promise<Landing> {
  const [preferences] = await db
    .select({
      lastWorkspaceId: schema.userPreferences.lastWorkspaceId,
      lastDocumentId: schema.userPreferences.lastDocumentId,
    })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);

  const remembered = preferences?.lastWorkspaceId ?? null;

  if (remembered && (await resolveWorkspaceAccess(db, userId, remembered))) {
    const lastDocument = preferences?.lastDocumentId ?? null;

    if (lastDocument && (await openablePageIn(db, remembered, lastDocument))) {
      return { workspaceId: remembered, documentId: lastDocument };
    }

    return { workspaceId: remembered, documentId: await firstPage(db, remembered) };
  }

  const fallback = await fallbackWorkspace(db, userId);
  if (!fallback) return { workspaceId: null, documentId: null };

  return { workspaceId: fallback, documentId: await firstPage(db, fallback) };
}

export async function rememberLocation(
  db: Database,
  userId: string,
  workspaceId: string,
  documentId: string | null,
): Promise<boolean> {
  if (!(await resolveWorkspaceAccess(db, userId, workspaceId))) return false;

  if (documentId && !(await openablePageIn(db, workspaceId, documentId))) return false;

  await db
    .insert(schema.userPreferences)
    .values({ userId, lastWorkspaceId: workspaceId, lastDocumentId: documentId })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: { lastWorkspaceId: workspaceId, lastDocumentId: documentId, updatedAt: new Date() },
    });

  return true;
}
