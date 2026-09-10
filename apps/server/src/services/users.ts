import { createHash } from 'node:crypto';
import { eq, schema, type Database } from '@collaby/db';

const AVATAR_PALETTE = [
  '#7c9cff',
  '#68d391',
  '#f6ad55',
  '#fc8181',
  '#b794f4',
  '#4fd1c5',
  '#f687b3',
  '#a0aec0',
];

export function avatarColorFor(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  const index = digest[0]! % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index]!;
}

export async function findUserByEmail(db: Database, email: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

  return user ?? null;
}

export async function findUserById(db: Database, userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user ?? null;
}
