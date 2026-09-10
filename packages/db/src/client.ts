import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(connectionString: string, options?: { max?: number }) {
  const client = postgres(connectionString, {
    max: options?.max ?? 10,
    prepare: false,
  });

  const db = drizzle(client, { schema, casing: 'snake_case' });

  return { db, client };
}

export function runMigrations(db: Database, migrationsFolder: string): Promise<void> {
  return migrate(db, { migrationsFolder });
}
