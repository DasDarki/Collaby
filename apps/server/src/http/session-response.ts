import type { FastifyReply } from 'fastify';
import { eq, schema } from '@collaby/db';
import type { AuthResult, PublicUser } from '@collaby/shared';
import type { AppContext } from '../context.js';
import type { IssuedSession } from '../auth/sessions.js';

export const REFRESH_COOKIE_NAME = 'collaby_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';

export function setRefreshCookie(
  reply: FastifyReply,
  context: AppContext,
  session: IssuedSession,
): void {
  reply.setCookie(REFRESH_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    secure: context.env.cookieSecure,
    sameSite: context.env.cookieSameSite,
    path: REFRESH_COOKIE_PATH,
    domain: context.env.COOKIE_DOMAIN,
    expires: session.expiresAt,
  });
}

export function clearRefreshCookie(reply: FastifyReply, context: AppContext): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: context.env.cookieSecure,
    sameSite: context.env.cookieSameSite,
    path: REFRESH_COOKIE_PATH,
    domain: context.env.COOKIE_DOMAIN,
  });
}

export async function buildAuthResult(
  context: AppContext,
  userId: string,
  session: IssuedSession,
): Promise<AuthResult> {
  const [user] = await context.db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarColor: schema.users.avatarColor,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) throw new Error(`User ${userId} disappeared while issuing a session`);

  const access = await context.accessTokens.sign({ userId, sessionId: session.sessionId });

  return {
    user: user satisfies PublicUser,
    sessionId: session.sessionId,
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
  };
}
