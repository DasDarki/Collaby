import fs from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import git from 'isomorphic-git';

export interface GitAuthor {
  name: string;
  email: string;
}

export interface WorkspaceRepositoryOptions {
  dataDir: string;
  defaultAuthor: GitAuthor;
}

export interface CommitRequest {
  workspaceId: string;
  filepath: string;
  content: string;
  message: string;
  author?: GitAuthor;
}

export interface RemoveRequest {
  workspaceId: string;
  filepath: string;
  message: string;
  author?: GitAuthor;
}

export interface RenameRequest {
  workspaceId: string;
  fromPath: string;
  toPath: string;
  content: string;
  message: string;
  author?: GitAuthor;
}

export interface RevisionEntry {
  oid: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
}

export class WorkspaceRepository {
  private readonly dataDir: string;
  private readonly defaultAuthor: GitAuthor;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(options: WorkspaceRepositoryOptions) {
    this.dataDir = resolve(options.dataDir, 'repos');
    this.defaultAuthor = options.defaultAuthor;
  }

  private directoryFor(workspaceId: string): string {
    return join(this.dataDir, workspaceId);
  }

  private serialize<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(
      workspaceId,
      next.catch(() => undefined),
    );
    return next;
  }

  async ensureRepository(workspaceId: string): Promise<string> {
    const dir = this.directoryFor(workspaceId);
    await mkdir(dir, { recursive: true });

    const alreadyInitialized = fs.existsSync(join(dir, '.git'));
    if (!alreadyInitialized) {
      await git.init({ fs, dir, defaultBranch: 'main' });
    }

    return dir;
  }

  async commitFile(request: CommitRequest): Promise<string | null> {
    return this.serialize(request.workspaceId, async () => {
      const dir = await this.ensureRepository(request.workspaceId);
      const target = join(dir, request.filepath);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, request.content, 'utf8');
      await git.add({ fs, dir, filepath: request.filepath });

      return this.commitIfChanged(dir, request.message, request.author);
    });
  }

  async removeFile(request: RemoveRequest): Promise<string | null> {
    return this.serialize(request.workspaceId, async () => {
      const dir = await this.ensureRepository(request.workspaceId);
      const target = join(dir, request.filepath);

      if (!fs.existsSync(target)) return null;

      await rm(target, { force: true });
      await git.remove({ fs, dir, filepath: request.filepath });

      return this.commitIfChanged(dir, request.message, request.author);
    });
  }

  async renameFile(request: RenameRequest): Promise<string | null> {
    return this.serialize(request.workspaceId, async () => {
      const dir = await this.ensureRepository(request.workspaceId);
      const from = join(dir, request.fromPath);
      const to = join(dir, request.toPath);

      if (fs.existsSync(from)) {
        await rm(from, { force: true });
        await git.remove({ fs, dir, filepath: request.fromPath });
      }

      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, request.content, 'utf8');
      await git.add({ fs, dir, filepath: request.toPath });

      return this.commitIfChanged(dir, request.message, request.author);
    });
  }

  private async commitIfChanged(
    dir: string,
    message: string,
    author?: GitAuthor,
  ): Promise<string | null> {
    const status = await git.statusMatrix({ fs, dir });
    const hasChanges = status.some(
      ([, head, workdir, stage]) => head !== workdir || workdir !== stage || head !== stage,
    );

    if (!hasChanges) return null;

    return git.commit({
      fs,
      dir,
      message,
      author: {
        name: author?.name ?? this.defaultAuthor.name,
        email: author?.email ?? this.defaultAuthor.email,
      },
    });
  }

  async listRevisions(workspaceId: string, filepath: string, limit = 50): Promise<RevisionEntry[]> {
    const dir = this.directoryFor(workspaceId);
    if (!fs.existsSync(join(dir, '.git'))) return [];

    try {
      const commits = await git.log({ fs, dir, filepath, follow: true, depth: limit });
      return commits.map((entry) => ({
        oid: entry.oid,
        message: entry.commit.message.trim(),
        authorName: entry.commit.author.name,
        authorEmail: entry.commit.author.email,
        committedAt: new Date(entry.commit.author.timestamp * 1000).toISOString(),
      }));
    } catch {
      return [];
    }
  }

  async readRevision(workspaceId: string, filepath: string, oid: string): Promise<string | null> {
    const dir = this.directoryFor(workspaceId);
    if (!fs.existsSync(join(dir, '.git'))) return null;

    try {
      const blob = await git.readBlob({ fs, dir, oid, filepath });
      return Buffer.from(blob.blob).toString('utf8');
    } catch {
      return null;
    }
  }
}

export function toRepositoryPath(segments: string[]): string {
  const safe = segments
    .map((segment) => segment.replace(/[/\\]/g, '-').replace(/^\.+/, '').trim())
    .filter((segment) => segment.length > 0);

  const filename = safe.pop() ?? 'untitled';
  return posix.join(...safe, `${filename}.md`);
}
