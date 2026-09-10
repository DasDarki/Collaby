import { and, eq, inArray, isNull, type Database, schema, sql } from '@collaby/db';
import { highestRole, type AccessRole } from '@collaby/shared';

export type AccessSource = 'owner' | 'workspace' | 'document' | 'link';

export interface ResolvedAccess {
  role: AccessRole;
  source: AccessSource;
}

export interface ShareLinkGrant {
  role: AccessRole;
  documentId: string | null;
  workspaceId: string | null;
}

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  slug: string;
  icon: string | null;
  position: number;
  isFolder: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function loadDocument(
  db: Database,
  documentId: string,
): Promise<DocumentRecord | null> {
  const [row] = await db
    .select({
      id: schema.documents.id,
      workspaceId: schema.documents.workspaceId,
      parentId: schema.documents.parentId,
      title: schema.documents.title,
      slug: schema.documents.slug,
      icon: schema.documents.icon,
      position: schema.documents.position,
      isFolder: schema.documents.isFolder,
      createdAt: schema.documents.createdAt,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt)))
    .limit(1);

  return row ?? null;
}

export async function resolveWorkspaceAccess(
  db: Database,
  userId: string | null,
  workspaceId: string,
): Promise<ResolvedAccess | null> {
  if (!userId) return null;

  const [workspace] = await db
    .select({ ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) return null;
  if (workspace.ownerId === userId) return { role: 'owner', source: 'owner' };

  const [membership] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  return membership ? { role: membership.role, source: 'workspace' } : null;
}

async function ancestorChain(db: Database, documentId: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id FROM documents WHERE id = ${documentId} AND deleted_at IS NULL
      UNION ALL
      SELECT d.id, d.parent_id
      FROM documents d
      JOIN chain c ON d.id = c.parent_id
      WHERE d.deleted_at IS NULL
    )
    SELECT id FROM chain
  `);

  return [...result].map((row) => row.id);
}

async function resolveDirectDocumentRole(
  db: Database,
  userId: string,
  documentIds: string[],
): Promise<AccessRole | null> {
  if (documentIds.length === 0) return null;

  const rows = await db
    .select({ role: schema.documentPermissions.role })
    .from(schema.documentPermissions)
    .where(
      and(
        eq(schema.documentPermissions.userId, userId),
        inArray(schema.documentPermissions.documentId, documentIds),
      ),
    );

  return highestRole(...rows.map((row) => row.role));
}

export interface DocumentAccessResult {
  document: DocumentRecord;
  role: AccessRole;
  source: AccessSource;
}

export async function resolveDocumentAccess(
  db: Database,
  userId: string | null,
  documentId: string,
  linkGrant?: ShareLinkGrant | null,
): Promise<DocumentAccessResult | null> {
  const document = await loadDocument(db, documentId);
  if (!document) return null;

  const candidates: { role: AccessRole; source: AccessSource }[] = [];

  if (userId) {
    const workspaceAccess = await resolveWorkspaceAccess(db, userId, document.workspaceId);
    if (workspaceAccess) candidates.push(workspaceAccess);

    const chain = await ancestorChain(db, documentId);
    const documentRole = await resolveDirectDocumentRole(db, userId, chain);
    if (documentRole) candidates.push({ role: documentRole, source: 'document' });
  }

  if (linkGrant) {
    if (linkGrant.workspaceId && linkGrant.workspaceId === document.workspaceId) {
      candidates.push({ role: linkGrant.role, source: 'link' });
    } else if (linkGrant.documentId) {
      const chain = await ancestorChain(db, documentId);
      if (chain.includes(linkGrant.documentId)) {
        candidates.push({ role: linkGrant.role, source: 'link' });
      }
    }
  }

  if (candidates.length === 0) return null;

  const best = candidates.reduce((winner, candidate) =>
    highestRole(winner.role, candidate.role) === candidate.role && winner.role !== candidate.role
      ? candidate
      : winner,
  );

  return { document, role: best.role, source: best.source };
}
