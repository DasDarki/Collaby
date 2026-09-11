import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CliError } from './errors.js';

export const META_DIR = '.collaby';

export interface Config {
  version: 1;
  server: string;
  webUrl: string;
  createdAt: string;
}

export interface Credentials {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
  user: { email: string; displayName: string };
}

export interface FileEntry {
  path: string;
  title: string;
  hash: string;
  fileHash: string;
  updatedAt: string;
}

export interface State {
  cursor: string | null;
  lastPullAt: string | null;
  files: Record<string, FileEntry>;
}

export function metaPath(root: string, ...parts: string[]): string {
  return join(root, META_DIR, ...parts);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function findRoot(start: string): Promise<string | null> {
  let current = resolve(start);

  for (;;) {
    if (await exists(join(current, META_DIR, 'config.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function requireRoot(start: string): Promise<string> {
  const root = await findRoot(start);
  if (!root) {
    throw new CliError('This is not a Collaby sync folder. Run collaby setup <url> here first.');
  }
  return root;
}

export async function writeJsonAtomic(path: string, data: unknown, mode = 0o644): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode });
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function initMeta(root: string, config: Config): Promise<void> {
  await mkdir(metaPath(root, 'cache'), { recursive: true });
  await writeFile(metaPath(root, '.gitignore'), '*\n');
  await writeJsonAtomic(metaPath(root, 'config.json'), config);
  await writeJsonAtomic(metaPath(root, 'state.json'), {
    cursor: null,
    lastPullAt: null,
    files: {},
  });
}

export async function readConfig(root: string): Promise<Config> {
  const config = await readJson<Config>(metaPath(root, 'config.json'));
  if (!config) throw new CliError('The .collaby/config.json file is missing or unreadable.');
  return config;
}

export async function readCredentials(root: string): Promise<Credentials | null> {
  return readJson<Credentials>(metaPath(root, 'credentials.json'));
}

export async function writeCredentials(root: string, credentials: Credentials): Promise<void> {
  await writeJsonAtomic(metaPath(root, 'credentials.json'), credentials, 0o600);
}

export async function deleteCredentials(root: string): Promise<void> {
  await rm(metaPath(root, 'credentials.json'), { force: true });
}

export async function readState(root: string): Promise<State> {
  return (
    (await readJson<State>(metaPath(root, 'state.json'))) ?? {
      cursor: null,
      lastPullAt: null,
      files: {},
    }
  );
}

export async function writeState(root: string, state: State): Promise<void> {
  await writeJsonAtomic(metaPath(root, 'state.json'), state);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function withLock<T>(
  root: string,
  name: string,
  task: () => Promise<T>,
  waitMs = 30_000,
): Promise<T> {
  const lockFile = metaPath(root, `${name}.lock`);
  const deadline = Date.now() + waitMs;

  for (;;) {
    try {
      const handle = await open(
        lockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      const holder = await readJson<{ pid: number; at: number }>(lockFile);
      const stale = !holder || !processAlive(holder.pid) || Date.now() - holder.at > 10 * 60_000;

      if (stale) {
        await rm(lockFile, { force: true });
        continue;
      }

      if (Date.now() > deadline) {
        throw new CliError(
          `Another collaby command is still running in this folder (pid ${holder.pid}).`,
        );
      }

      await new Promise((done) => setTimeout(done, 200));
    }
  }

  try {
    return await task();
  } finally {
    await rm(lockFile, { force: true });
  }
}
