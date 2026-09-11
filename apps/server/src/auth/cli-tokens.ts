import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'collaby';
const AUDIENCE = 'collaby-cli';

export interface CliTokenClaims {
  userId: string;
  sessionId: string;
}

export async function signCliAccessToken(
  secret: string,
  ttlSeconds: number,
  claims: CliTokenClaims,
): Promise<{ token: string; expiresAt: Date }> {
  const key = new TextEncoder().encode(secret);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;

  const token = await new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key);

  return { token, expiresAt: new Date(expiresAt * 1000) };
}

export async function verifyCliAccessToken(
  secret: string,
  token: string,
): Promise<CliTokenClaims | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}
