import { SignJWT, jwtVerify } from 'jose';
import type { AccessRole } from '@collaby/shared';

const ISSUER = 'collaby';
const AUDIENCE = 'collaby-share';
const TTL_SECONDS = 60 * 60 * 12;

export interface ShareGrantClaims {
  shareLinkId: string;
  role: AccessRole;
  documentId: string | null;
  workspaceId: string | null;
}

export async function signShareGrant(
  secret: string,
  claims: ShareGrantClaims,
): Promise<{ token: string; expiresAt: Date }> {
  const key = new TextEncoder().encode(secret);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TTL_SECONDS;

  const token = await new SignJWT({
    role: claims.role,
    documentId: claims.documentId,
    workspaceId: claims.workspaceId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.shareLinkId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key);

  return { token, expiresAt: new Date(expiresAt * 1000) };
}

export async function verifyShareGrant(
  secret: string,
  token: string,
): Promise<ShareGrantClaims | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE });

    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;

    return {
      shareLinkId: payload.sub,
      role: payload.role as AccessRole,
      documentId: (payload.documentId as string | null) ?? null,
      workspaceId: (payload.workspaceId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
