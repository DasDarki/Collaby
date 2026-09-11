import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { and, eq, inArray, isNull, schema, sql, type Database } from '@collaby/db';
import type { CliScope } from '@collaby/shared';

export interface ScopedDocument {
  id: string;
  title: string;
  path: string;
  workspaceId: string;
  workspaceName: string;
  updatedAt: string;
  hash: string;
}

export interface Manifest {
  cursor: string;
  documents: ScopedDocument[];
}

type VisibleRow = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  isFolder: boolean;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  updatedAt: Date;
  hash: string;
};

function scopeParameters(scope: CliScope) {
  return {
    all: scope.all,
    workspaces: JSON.stringify(scope.all ? [] : scope.workspaces),
    folders: JSON.stringify(scope.all ? [] : scope.folders),
  };
}

async function visibleDocuments(
  db: Database,
  userId: string,
  scope: CliScope,
): Promise<VisibleRow[]> {
  const parameters = scopeParameters(scope);

  const rows = await db.execute<VisibleRow>(sql`
    WITH RECURSIVE
    member_workspaces AS (
      SELECT workspace_id AS id FROM workspace_members WHERE user_id = ${userId}
    ),
    requested_workspaces AS (
      SELECT (value)::uuid AS id FROM jsonb_array_elements_text(${parameters.workspaces}::jsonb)
    ),
    requested_folders AS (
      SELECT (value)::uuid AS id FROM jsonb_array_elements_text(${parameters.folders}::jsonb)
    ),
    granted_workspaces AS (
      SELECT m.id FROM member_workspaces m
      WHERE ${parameters.all}::boolean OR m.id IN (SELECT id FROM requested_workspaces)
    ),
    granted_tree AS (
      SELECT d.id
      FROM documents d
      JOIN member_workspaces m ON m.id = d.workspace_id
      WHERE d.id IN (SELECT id FROM requested_folders) AND d.deleted_at IS NULL
      UNION
      SELECT child.id
      FROM documents child
      JOIN granted_tree tree ON child.parent_id = tree.id
      WHERE child.deleted_at IS NULL
    ),
    visible AS (
      SELECT d.id FROM documents d
      JOIN granted_workspaces g ON g.id = d.workspace_id
      WHERE d.deleted_at IS NULL
      UNION
      SELECT id FROM granted_tree
    )
    SELECT
      d.id,
      d.parent_id AS "parentId",
      d.slug,
      d.title,
      d.is_folder AS "isFolder",
      d.workspace_id AS "workspaceId",
      w.slug AS "workspaceSlug",
      w.name AS "workspaceName",
      GREATEST(d.updated_at, COALESCE(ds.updated_at, d.updated_at)) AS "updatedAt",
      md5(COALESCE(ds.markdown, '')) AS hash
    FROM documents d
    JOIN visible v ON v.id = d.id
    JOIN workspaces w ON w.id = d.workspace_id
    LEFT JOIN document_states ds ON ds.document_id = d.id
  `);

  return [...rows];
}

function buildPaths(rows: VisibleRow[]): Map<string, string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<string, string>();

  for (const row of rows) {
    if (row.isFolder) continue;

    const segments: string[] = [];
    let current: VisibleRow | undefined = row;

    while (current) {
      segments.unshift(current.slug);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    const leaf = segments.pop() ?? row.id;
    paths.set(row.id, posix.join(row.workspaceSlug, ...segments, `${leaf}.md`));
  }

  return paths;
}

export async function buildManifest(
  db: Database,
  userId: string,
  scope: CliScope,
): Promise<Manifest> {
  const rows = await visibleDocuments(db, userId, scope);
  const paths = buildPaths(rows);

  const documents = rows
    .filter((row) => !row.isFolder)
    .map((row) => ({
      id: row.id,
      title: row.title,
      path: paths.get(row.id)!,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      updatedAt: new Date(row.updatedAt).toISOString(),
      hash: row.hash,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const fingerprint = documents
    .map((document) => `${document.id}:${document.path}:${document.hash}`)
    .join('|');

  return { cursor: digest(fingerprint), documents };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export async function readScopedMarkdown(
  db: Database,
  userId: string,
  scope: CliScope,
  ids: string[],
): Promise<{ id: string; markdown: string }[]> {
  if (ids.length === 0) return [];

  const allowed = new Set(
    (await visibleDocuments(db, userId, scope)).filter((row) => !row.isFolder).map((row) => row.id),
  );

  const permitted = ids.filter((id) => allowed.has(id));
  if (permitted.length === 0) return [];

  const rows = await db
    .select({ id: schema.documentStates.documentId, markdown: schema.documentStates.markdown })
    .from(schema.documentStates)
    .where(inArray(schema.documentStates.documentId, permitted));

  const found = new Map(rows.map((row) => [row.id, row.markdown]));
  return permitted.map((id) => ({ id, markdown: found.get(id) ?? '' }));
}

export async function validateScope(
  db: Database,
  userId: string,
  scope: CliScope,
): Promise<string | null> {
  if (scope.all) return null;

  if (scope.workspaces.length === 0 && scope.folders.length === 0) {
    return 'Choose at least one workspace or folder';
  }

  const memberships = await db
    .select({ id: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId));
  const member = new Set(memberships.map((row) => row.id));

  if (scope.workspaces.some((id) => !member.has(id))) {
    return 'One of the chosen workspaces is not yours to share';
  }

  if (scope.folders.length > 0) {
    const folders = await db
      .select({ id: schema.documents.id, workspaceId: schema.documents.workspaceId })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, scope.folders),
          eq(schema.documents.isFolder, true),
          isNull(schema.documents.deletedAt),
        ),
      );

    const valid = folders.filter((folder) => member.has(folder.workspaceId));
    if (valid.length !== new Set(scope.folders).size) {
      return 'One of the chosen folders is not available';
    }
  }

  return null;
}
