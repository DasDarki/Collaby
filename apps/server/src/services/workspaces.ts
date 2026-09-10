import { and, eq, schema, sql, type Database } from '@collaby/db';
import type { AccessRole, WorkspaceSummary } from '@collaby/shared';
import { slugify } from './document-path.js';

export async function uniqueWorkspaceSlug(db: Database, desired: string): Promise<string> {
  const base = slugify(desired, 'workspace');
  let candidate = base;
  let attempt = 1;

  for (;;) {
    const existing = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, candidate))
      .limit(1);

    if (existing.length === 0) return candidate;
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
}

export async function createWorkspace(
  db: Database,
  ownerId: string,
  name: string,
  kind: 'personal' | 'group',
): Promise<{ id: string; slug: string }> {
  const slug = await uniqueWorkspaceSlug(db, name);

  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ name, slug, kind, ownerId })
    .returning({ id: schema.workspaces.id, slug: schema.workspaces.slug });

  if (!workspace) throw new Error('Failed to create workspace');

  await db.insert(schema.workspaceMembers).values({
    workspaceId: workspace.id,
    userId: ownerId,
    role: 'owner',
  });

  return workspace;
}

export async function listWorkspacesForUser(
  db: Database,
  userId: string,
): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      kind: schema.workspaces.kind,
      slug: schema.workspaces.slug,
      ownerId: schema.workspaces.ownerId,
      role: schema.workspaceMembers.role,
      createdAt: schema.workspaces.createdAt,
      memberCount: sql<number>`(
        SELECT COUNT(*)::int FROM workspace_members wm WHERE wm.workspace_id = ${schema.workspaces.id}
      )`,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(schema.workspaces.createdAt);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    slug: row.slug,
    role: (row.ownerId === userId ? 'owner' : row.role) as AccessRole,
    memberCount: row.memberCount,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function isWorkspaceMember(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  return Boolean(row);
}
