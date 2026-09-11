import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CollabyClient } from './client.js';
import { CliError } from './errors.js';
import { render } from './render.js';
import {
  META_DIR,
  metaPath,
  readConfig,
  readState,
  withLock,
  writeState,
  type FileEntry,
} from './store.js';

const BATCH_SIZE = 100;

export interface ManifestDocument {
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
  documents: ManifestDocument[];
}

export interface PullSummary {
  total: number;
  created: string[];
  updated: string[];
  moved: { from: string; to: string }[];
  removed: string[];
  preserved: string[];
  cursor: string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function insideRoot(root: string, relativePath: string): string {
  const base = resolve(root);
  const target = resolve(base, ...relativePath.split('/'));

  if (!target.startsWith(base + sep)) {
    throw new CliError(`Refusing to write outside the sync folder: ${relativePath}`);
  }

  if (relative(base, target).split(sep)[0] === META_DIR) {
    throw new CliError(`Refusing to write into ${META_DIR}: ${relativePath}`);
  }

  return target;
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function pruneEmptyDirectories(root: string, start: string): Promise<void> {
  const base = resolve(root);
  let current = dirname(start);

  while (current.startsWith(base + sep)) {
    const entries = await readdir(current).catch(() => null);
    if (!entries || entries.length > 0) return;
    await rmdir(current).catch(() => undefined);
    current = dirname(current);
  }
}

async function preserve(
  root: string,
  stamp: string,
  relativePath: string,
  content: Buffer,
): Promise<void> {
  const destination = metaPath(root, 'local-changes', stamp, ...relativePath.split('/'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function refreshCache(
  root: string,
  client: CollabyClient,
  manifest: Manifest,
  known: Record<string, FileEntry>,
): Promise<void> {
  const stale: string[] = [];

  for (const document of manifest.documents) {
    const cached = await readIfPresent(metaPath(root, 'cache', `${document.id}.md`));
    if (!cached || known[document.id]?.hash !== document.hash) stale.push(document.id);
  }

  for (let index = 0; index < stale.length; index += BATCH_SIZE) {
    const ids = stale.slice(index, index + BATCH_SIZE);
    const { documents } = await client.call<{ documents: { id: string; markdown: string }[] }>(
      '/api/cli/documents',
      { method: 'POST', body: { ids } },
    );

    for (const document of documents) {
      await writeFile(metaPath(root, 'cache', `${document.id}.md`), document.markdown);
    }
  }
}

export async function pull(root: string, client: CollabyClient): Promise<PullSummary> {
  return withLock(root, 'sync', async () => {
    const config = await readConfig(root);
    const state = await readState(root);
    const manifest = await client.call<Manifest>('/api/cli/manifest');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    await refreshCache(root, client, manifest, state.files);

    const pathsById = new Map(manifest.documents.map((document) => [document.id, document.path]));
    const summary: PullSummary = {
      total: manifest.documents.length,
      created: [],
      updated: [],
      moved: [],
      removed: [],
      preserved: [],
      cursor: manifest.cursor,
    };

    const nextFiles: Record<string, FileEntry> = {};

    for (const document of manifest.documents) {
      const markdown =
        (await readIfPresent(metaPath(root, 'cache', `${document.id}.md`)))?.toString('utf8') ?? '';
      const content = render(markdown, document, pathsById, config.server, config.webUrl);
      const fileHash = sha256(content);
      const previous = state.files[document.id];
      const target = insideRoot(root, document.path);

      if (previous && previous.path !== document.path) {
        const oldTarget = insideRoot(root, previous.path);
        const oldContent = await readIfPresent(oldTarget);

        if (oldContent) {
          if (sha256(oldContent) !== previous.fileHash) {
            await preserve(root, stamp, previous.path, oldContent);
            summary.preserved.push(previous.path);
          }
          await rm(oldTarget, { force: true });
          await pruneEmptyDirectories(root, oldTarget);
        }

        summary.moved.push({ from: previous.path, to: document.path });
      }

      const onDisk = await readIfPresent(target);
      const diskHash = onDisk ? sha256(onDisk) : null;

      if (diskHash !== fileHash) {
        if (onDisk && diskHash !== previous?.fileHash) {
          await preserve(root, stamp, document.path, onDisk);
          summary.preserved.push(document.path);
        }

        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);

        const wasMoved = summary.moved.some((move) => move.to === document.path);
        if (!previous || !onDisk) {
          if (!wasMoved) summary.created.push(document.path);
        } else {
          summary.updated.push(document.path);
        }
      }

      nextFiles[document.id] = {
        path: document.path,
        title: document.title,
        hash: document.hash,
        fileHash,
        updatedAt: document.updatedAt,
      };
    }

    for (const [id, entry] of Object.entries(state.files)) {
      if (nextFiles[id]) continue;

      const target = insideRoot(root, entry.path);
      const onDisk = await readIfPresent(target);

      if (onDisk) {
        if (sha256(onDisk) !== entry.fileHash) {
          await preserve(root, stamp, entry.path, onDisk);
          summary.preserved.push(entry.path);
        }
        await rm(target, { force: true });
        await pruneEmptyDirectories(root, target);
      }

      await rm(metaPath(root, 'cache', `${id}.md`), { force: true });
      summary.removed.push(entry.path);
    }

    await writeState(root, {
      cursor: manifest.cursor,
      lastPullAt: new Date().toISOString(),
      files: nextFiles,
    });

    return summary;
  });
}

export function describe(summary: PullSummary): string[] {
  const lines: string[] = [];
  const changes =
    summary.created.length + summary.updated.length + summary.moved.length + summary.removed.length;

  if (changes === 0) {
    lines.push(`Up to date. ${summary.total} page${summary.total === 1 ? '' : 's'}.`);
  } else {
    for (const path of summary.created) lines.push(`  added     ${path}`);
    for (const path of summary.updated) lines.push(`  updated   ${path}`);
    for (const move of summary.moved) lines.push(`  moved     ${move.from} -> ${move.to}`);
    for (const path of summary.removed) lines.push(`  removed   ${path}`);
    lines.push(`Synced ${summary.total} page${summary.total === 1 ? '' : 's'}.`);
  }

  if (summary.preserved.length > 0) {
    lines.push(
      `Kept your local edits to ${summary.preserved.length} file${summary.preserved.length === 1 ? '' : 's'} in ${META_DIR}/local-changes before restoring the server version.`,
    );
  }

  return lines;
}
