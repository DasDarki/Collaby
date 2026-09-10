import { sql, type Database } from '@collaby/db';
import type { SearchHit, SnippetPart } from '@collaby/shared';

const HIGHLIGHT_START = '\u0001';
const HIGHLIGHT_END = '\u0002';

const HEADLINE_OPTIONS = [
  `StartSel=${HIGHLIGHT_START}`,
  `StopSel=${HIGHLIGHT_END}`,
  'MaxFragments=2',
  'MinWords=5',
  'MaxWords=18',
  'ShortWord=2',
  'FragmentDelimiter=…',
].join(',');

type SearchRow = {
  id: string;
  title: string;
  icon: string | null;
  workspaceId: string;
  workspaceName: string;
  updatedAt: Date;
  snippet: string | null;
  rank: number;
};

function tidy(text: string): string {
  return text
    .replace(/^[>\s]*#{1,6}\s+/gm, '')
    .replace(/[*_`]{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function splitSnippet(raw: string): SnippetPart[] {
  const cleaned = tidy(raw);
  const parts: SnippetPart[] = [];
  let rest = cleaned;

  while (rest.length > 0) {
    const start = rest.indexOf(HIGHLIGHT_START);

    if (start === -1) {
      parts.push({ text: rest, match: false });
      break;
    }

    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });

    const end = rest.indexOf(HIGHLIGHT_END, start + 1);

    if (end === -1) {
      parts.push({ text: rest.slice(start + 1), match: true });
      break;
    }

    parts.push({ text: rest.slice(start + 1, end), match: true });
    rest = rest.slice(end + 1);
  }

  return parts.filter((part) => part.text.length > 0);
}

export function toPrefixTsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((term) => term.length > 0)
    .slice(0, 8)
    .map((term) => `${term}:*`);

  return terms.length > 0 ? terms.join(' & ') : null;
}

export async function searchDocuments(
  db: Database,
  userId: string,
  query: string,
  options: { workspaceId?: string | undefined; limit?: number } = {},
): Promise<SearchHit[]> {
  const tsquery = toPrefixTsQuery(query);
  if (!tsquery) return [];

  const limit = Math.min(options.limit ?? 20, 50);
  const workspaceFilter = options.workspaceId
    ? sql`AND d.workspace_id = ${options.workspaceId}`
    : sql``;

  const rows = await db.execute<SearchRow>(sql`
    WITH RECURSIVE shared AS (
      SELECT d.id
      FROM documents d
      JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = ${userId}
      WHERE d.deleted_at IS NULL
      UNION
      SELECT child.id
      FROM documents child
      JOIN shared s ON child.parent_id = s.id
      WHERE child.deleted_at IS NULL
    ),
    accessible AS (
      SELECT d.id
      FROM documents d
      JOIN workspace_members wm ON wm.workspace_id = d.workspace_id AND wm.user_id = ${userId}
      WHERE d.deleted_at IS NULL
      UNION
      SELECT id FROM shared
    ),
    matcher AS (SELECT to_tsquery('simple', ${tsquery}) AS q)
    SELECT
      d.id,
      d.title,
      d.icon,
      d.workspace_id AS "workspaceId",
      w.name AS "workspaceName",
      d.updated_at AS "updatedAt",
      ts_headline('simple', COALESCE(ds.markdown, ''), matcher.q, ${HEADLINE_OPTIONS}) AS snippet,
      (
        ts_rank(d.title_vector, matcher.q) * 4
        + ts_rank(COALESCE(ds.search_vector, ''::tsvector), matcher.q)
      ) AS rank
    FROM documents d
    JOIN accessible a ON a.id = d.id
    JOIN workspaces w ON w.id = d.workspace_id
    LEFT JOIN document_states ds ON ds.document_id = d.id
    CROSS JOIN matcher
    WHERE d.deleted_at IS NULL
      ${workspaceFilter}
      AND (d.title_vector @@ matcher.q OR ds.search_vector @@ matcher.q)
    ORDER BY rank DESC, d.updated_at DESC
    LIMIT ${limit}
  `);

  return [...rows].map((row) => ({
    id: row.id,
    title: row.title,
    icon: row.icon,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    updatedAt: new Date(row.updatedAt).toISOString(),
    snippet: splitSnippet(row.snippet ?? ''),
    rank: Number(row.rank),
  }));
}
