import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDatabase } from './client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const { db, client } = createDatabase(connectionString, { max: 1 });

try {
  await migrate(db, { migrationsFolder });
  console.log('Migrations applied');
} catch (error) {
  console.error('Migration failed', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
