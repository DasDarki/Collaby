import { and, asc, eq, inArray, isNotNull, isNull, schema, sql, type Database } from '@collaby/db';

export interface ReorderResult {
  parentId: string | null;
  index: number;
}

function siblingFilter(workspaceId: string, parentId: string | null) {
  return and(
    eq(schema.documents.workspaceId, workspaceId),
    parentId ? eq(schema.documents.parentId, parentId) : isNull(schema.documents.parentId),
    isNull(schema.documents.deletedAt),
  );
}

export async function isDescendantOf(
  db: Database,
  candidateId: string,
  ancestorId: string,
): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id FROM documents WHERE id = ${candidateId}
      UNION ALL
      SELECT d.id, d.parent_id FROM documents d JOIN chain c ON d.id = c.parent_id
    )
    SELECT id FROM chain
  `);

  return [...rows].some((row) => row.id === ancestorId);
}

export async function reorderDocument(
  db: Database,
  document: { id: string; workspaceId: string; parentId: string | null },
  nextParentId: string | null,
  requestedIndex: number | undefined,
): Promise<ReorderResult> {
  return db.transaction(async (tx) => {
    const siblings = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(siblingFilter(document.workspaceId, nextParentId))
      .orderBy(asc(schema.documents.position), asc(schema.documents.createdAt));

    const ordered = siblings.map((row) => row.id).filter((id) => id !== document.id);
    const index = Math.max(0, Math.min(requestedIndex ?? ordered.length, ordered.length));
    ordered.splice(index, 0, document.id);

    await tx
      .update(schema.documents)
      .set({ parentId: nextParentId, updatedAt: new Date() })
      .where(eq(schema.documents.id, document.id));

    for (const [position, id] of ordered.entries()) {
      await tx.update(schema.documents).set({ position }).where(eq(schema.documents.id, id));
    }

    if (document.parentId !== nextParentId) {
      const previous = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(siblingFilter(document.workspaceId, document.parentId))
        .orderBy(asc(schema.documents.position), asc(schema.documents.createdAt));

      for (const [position, row] of previous.entries()) {
        await tx.update(schema.documents).set({ position }).where(eq(schema.documents.id, row.id));
      }
    }

    return { parentId: nextParentId, index };
  });
}

export async function descendantIds(db: Database, documentId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM documents WHERE id = ${documentId} AND deleted_at IS NULL
      UNION ALL
      SELECT d.id
      FROM documents d
      JOIN subtree s ON d.parent_id = s.id
      WHERE d.deleted_at IS NULL
    )
    SELECT id FROM subtree
  `);

  return [...rows].map((row) => row.id);
}

export interface RestoredDocument {
  id: string;
  title: string;
  isFolder: boolean;
}

export async function restoreDeleted(
  db: Database,
  documentId: string,
  batchId: string | null,
): Promise<RestoredDocument[]> {
  return db.transaction(async (tx) => {
    const members = batchId
      ? await tx
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(
            and(eq(schema.documents.deletedBatchId, batchId), isNotNull(schema.documents.deletedAt)),
          )
      : await tx
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(and(eq(schema.documents.id, documentId), isNotNull(schema.documents.deletedAt)));

    const ids = members.map((row) => row.id);
    if (ids.length === 0) return [];

    await tx
      .update(schema.documents)
      .set({ deletedAt: null, deletedBatchId: null, updatedAt: new Date() })
      .where(inArray(schema.documents.id, ids));

    const restored = await tx
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        isFolder: schema.documents.isFolder,
        parentId: schema.documents.parentId,
        workspaceId: schema.documents.workspaceId,
      })
      .from(schema.documents)
      .where(inArray(schema.documents.id, ids));

    for (const document of restored) {
      if (!document.parentId) continue;

      const [parent] = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(eq(schema.documents.id, document.parentId), isNull(schema.documents.deletedAt)),
        )
        .limit(1);

      if (parent) continue;

      const [position] = await tx
        .select({ next: sql<number>`COALESCE(MAX(${schema.documents.position}), -1) + 1` })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.workspaceId, document.workspaceId),
            isNull(schema.documents.parentId),
            isNull(schema.documents.deletedAt),
          ),
        );

      await tx
        .update(schema.documents)
        .set({ parentId: null, position: position?.next ?? 0 })
        .where(eq(schema.documents.id, document.id));
    }

    return restored.map((document) => ({
      id: document.id,
      title: document.title,
      isFolder: document.isFolder,
    }));
  });
}
