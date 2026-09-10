import { and, asc, eq, isNull, schema, sql, type Database } from '@collaby/db';

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
