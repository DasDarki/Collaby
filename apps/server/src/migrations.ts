import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, type Database } from '@collaby/db';

const here = dirname(fileURLToPath(import.meta.url));

function resolveMigrationsFolder(configured?: string): string | null {
  const candidates = [
    configured,
    resolve(here, '..', 'migrations'),
    resolve(here, '..', '..', 'packages', 'db', 'migrations'),
    resolve(here, '..', '..', '..', 'packages', 'db', 'migrations'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function applyMigrations(db: Database, configured?: string): Promise<string> {
  const folder = resolveMigrationsFolder(configured);

  if (!folder) {
    throw new Error(
      'Could not find the database migrations folder. Set MIGRATIONS_DIR to its location.',
    );
  }

  await runMigrations(db, folder);
  return folder;
}
