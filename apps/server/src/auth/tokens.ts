import { SignJWT, jwtVerify } from 'jose';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface AccessTokenIssuer {
  sign: (claims: AccessTokenClaims) => Promise<{ token: string; expiresAt: Date }>;
  verify: (token: string) => Promise<AccessTokenClaims | null>;
}

const ISSUER = 'collaby';
const AUDIENCE = 'collaby-api';

export function createAccessTokenIssuer(secret: string, ttlSeconds: number): AccessTokenIssuer {
  const key = new TextEncoder().encode(secret);

  return {
    async sign(claims) {
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
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
        });
        if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
        return { userId: payload.sub, sessionId: payload.sid };
      } catch {
        return null;
      }
    },
  };
}
