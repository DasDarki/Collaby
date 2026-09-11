import { posix } from 'node:path';

export interface RenderTarget {
  id: string;
  title: string;
  path: string;
  workspaceName: string;
  updatedAt: string;
}

const INTERNAL_LINK = /\]\(collaby:doc\/([0-9a-f-]{36})((?:\s+"[^"]*")?)\)/g;
const SERVER_ASSET = /(\]\(|src=")\/api\/(assets|avatars)\//g;

function quote(value: string): string {
  return JSON.stringify(value);
}

export function render(
  markdown: string,
  document: RenderTarget,
  pathsById: Map<string, string>,
  server: string,
  webUrl: string,
): string {
  const from = posix.dirname(document.path);

  const body = markdown
    .replace(INTERNAL_LINK, (_match, id: string, title: string) => {
      const target = pathsById.get(id);
      if (!target) return `](${webUrl}/d/${id}${title})`;

      const relative = posix.relative(from, target);
      return `](${relative.startsWith('.') ? relative : `./${relative}`}${title})`;
    })
    .replace(
      SERVER_ASSET,
      (_match, prefix: string, kind: string) => `${prefix}${server}/api/${kind}/`,
    );

  const frontmatter = [
    '---',
    `title: ${quote(document.title)}`,
    `workspace: ${quote(document.workspaceName)}`,
    `updated: ${quote(document.updatedAt)}`,
    `source: ${quote(`${webUrl}/d/${document.id}`)}`,
    `collaby_id: ${quote(document.id)}`,
    '---',
    '',
  ].join('\n');

  const trimmed = body.replace(/^\n+/, '');
  return `${frontmatter}\n${trimmed.endsWith('\n') || trimmed.length === 0 ? trimmed : `${trimmed}\n`}`;
}
