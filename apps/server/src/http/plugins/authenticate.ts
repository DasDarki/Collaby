import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq, schema } from '@collaby/db';
import type { PublicUser } from '@collaby/shared';
import type { AppContext } from '../../context.js';
import { isSessionActive, touchSession } from '../../auth/sessions.js';
import { unauthorized } from '../errors.js';

export interface AuthenticatedRequestContext {
  userId: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthenticatedRequestContext | null;
  }

  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => AuthenticatedRequestContext;
    loadUser: (userId: string) => Promise<PublicUser | null>;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function authenticatePlugin(app: FastifyInstance, context: AppContext): Promise<void> {
  app.decorateRequest('auth', null);

  app.decorate('requireAuth', (request: FastifyRequest) => {
    if (!request.auth) throw unauthorized();
    return request.auth;
  });

  app.decorate('loadUser', async (userId: string) => {
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

    return user ?? null;
  });

  app.addHook('onRequest', async (request) => {
    const token = bearerToken(request);
    if (!token) return;

    const claims = await context.accessTokens.verify(token);
    if (!claims) return;

    if (!(await isSessionActive(context.db, claims.sessionId))) return;

    request.auth = { userId: claims.userId, sessionId: claims.sessionId };
    void touchSession(context.db, claims.sessionId);
  });
}

export default fp(authenticatePlugin, { name: 'collaby-authenticate' });
