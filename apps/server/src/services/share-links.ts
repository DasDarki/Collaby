import { and, eq, isNull, type Database, schema } from '@collaby/db';
import type { AccessRole } from '@collaby/shared';
import { verifyPassword } from '../auth/password.js';

export interface ShareLinkRecord {
  id: string;
  role: AccessRole;
  documentId: string | null;
  workspaceId: string | null;
  passwordHash: string | null;
  expiresAt: Date | null;
}

export async function findActiveShareLink(
  db: Database,
  token: string,
): Promise<ShareLinkRecord | null> {
  const [link] = await db
    .select({
      id: schema.shareLinks.id,
      role: schema.shareLinks.role,
      documentId: schema.shareLinks.documentId,
      workspaceId: schema.shareLinks.workspaceId,
      passwordHash: schema.shareLinks.passwordHash,
      expiresAt: schema.shareLinks.expiresAt,
    })
    .from(schema.shareLinks)
    .where(and(eq(schema.shareLinks.token, token), isNull(schema.shareLinks.revokedAt)))
    .limit(1);

  if (!link) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;

  return link;
}

export async function unlockShareLink(
  link: ShareLinkRecord,
  password: string | null,
): Promise<boolean> {
  if (!link.passwordHash) return true;
  if (!password) return false;
  return verifyPassword(link.passwordHash, password);
}
