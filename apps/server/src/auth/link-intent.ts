import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'collaby';
const AUDIENCE = 'collaby-identity-link';
const TTL_SECONDS = 600;

export async function signLinkIntent(secret: string, userId: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TTL_SECONDS)
    .sign(key);
}

export async function verifyLinkIntent(
  secret: string,
  token: string | null | undefined,
): Promise<string | null> {
  if (!token) return null;

  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
