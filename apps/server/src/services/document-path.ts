import { type Database, schema, sql } from '@collaby/db';
import { toRepositoryPath } from '../vcs/repository.js';

type ChainRow = {
  id: string;
  slug: string;
  depth: number;
};

export async function documentSlugChain(db: Database, documentId: string): Promise<string[]> {
  const rows = await db.execute<ChainRow>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, slug, 0 AS depth
      FROM documents
      WHERE id = ${documentId}
      UNION ALL
      SELECT d.id, d.parent_id, d.slug, c.depth + 1
      FROM documents d
      JOIN chain c ON d.id = c.parent_id
    )
    SELECT id, slug, depth FROM chain ORDER BY depth DESC
  `);

  return [...rows].map((row) => row.slug);
}

export async function documentRepositoryPath(db: Database, documentId: string): Promise<string> {
  const chain = await documentSlugChain(db, documentId);
  return toRepositoryPath(chain.length > 0 ? chain : [documentId]);
}

export function slugify(value: string, fallback = 'untitled'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug.length > 0 ? slug : fallback;
}

export async function uniqueDocumentSlug(
  db: Database,
  workspaceId: string,
  desired: string,
): Promise<string> {
  const base = slugify(desired);
  let candidate = base;
  let attempt = 1;

  for (;;) {
    const existing = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        sql`${schema.documents.workspaceId} = ${workspaceId} AND ${schema.documents.slug} = ${candidate}`,
      )
      .limit(1);

    if (existing.length === 0) return candidate;
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
}
