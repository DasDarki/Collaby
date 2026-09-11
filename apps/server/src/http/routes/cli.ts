import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, gt, schema } from '@collaby/db';
import type { CliScope } from '@collaby/shared';
import type { AppContext } from '../../context.js';
import { randomToken, sha256 } from '../../auth/crypto.js';
import { signCliAccessToken, verifyCliAccessToken } from '../../auth/cli-tokens.js';
import {
  createSession,
  loadActiveCliSession,
  revokeSession,
  rotateSession,
  touchSession,
} from '../../auth/sessions.js';
import { buildManifest, readScopedMarkdown, validateScope } from '../../services/cli-scope.js';
import { HttpError, badRequest, notFound, unauthorized } from '../errors.js';

const DEVICE_REQUEST_TTL_MS = 10 * 60 * 1000;
const LONG_POLL_MS = 25_000;
const POLL_STEP_MS = 1_000;
const WAIT_STEP_MS = 1_500;
const REFRESH_GRACE_SECONDS = 60;
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

const scopeSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({
    all: z.literal(false),
    workspaces: z.array(z.string().uuid()).max(200),
    folders: z.array(z.string().uuid()).max(500),
  }),
]);

const userCodeSchema = z.object({
  userCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/)
    .transform((value) => (value.includes('-') ? value : `${value.slice(0, 4)}-${value.slice(4)}`)),
});

interface CliAuth {
  userId: string;
  sessionId: string;
  scope: CliScope;
}

function generateUserCode(): string {
  const bytes = randomBytes(8);
  const characters = Array.from(bytes, (byte) =>
    USER_CODE_ALPHABET.charAt(byte % USER_CODE_ALPHABET.length),
  ).join('');
  return `${characters.slice(0, 4)}-${characters.slice(4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

export default async function cliRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const { db, env } = context;

  async function requireCli(request: FastifyRequest): Promise<CliAuth> {
    const header = request.headers.authorization;
    const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
    if (!token) throw unauthorized('This command needs you to sign in with collaby setup');

    const claims = await verifyCliAccessToken(env.JWT_SECRET, token);
    if (!claims) throw unauthorized('The access token is invalid or expired');

    const session = await loadActiveCliSession(db, claims.sessionId);
    if (!session || session.userId !== claims.userId) {
      throw unauthorized('This CLI session was signed out');
    }

    void touchSession(db, claims.sessionId);
    return { userId: claims.userId, sessionId: claims.sessionId, scope: session.scope };
  }

  async function issueTokens(
    userId: string,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ) {
    const access = await signCliAccessToken(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS, {
      userId,
      sessionId,
    });

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      sessionId,
    };
  }

  app.post(
    '/device',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const deviceCode = randomToken(48);
      const expiresAt = new Date(Date.now() + DEVICE_REQUEST_TTL_MS);

      let userCode = generateUserCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const [clash] = await db
          .select({ id: schema.cliDeviceRequests.id })
          .from(schema.cliDeviceRequests)
          .where(
            and(
              eq(schema.cliDeviceRequests.userCode, userCode),
              eq(schema.cliDeviceRequests.status, 'pending'),
              gt(schema.cliDeviceRequests.expiresAt, new Date()),
            ),
          )
          .limit(1);
        if (!clash) break;
        userCode = generateUserCode();
      }

      await db.insert(schema.cliDeviceRequests).values({
        deviceCodeHash: sha256(deviceCode),
        userCode,
        clientName: clip(body.clientName, 60) ?? 'Collaby CLI',
        hostname: clip(body.hostname, 80),
        platform: clip(body.platform, 40),
        ipAddress: request.ip ?? null,
        expiresAt,
      });

      const verificationUri = `${env.PUBLIC_WEB_URL}/cli/authorize`;

      return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete: `${verificationUri}?code=${userCode}`,
        expiresIn: Math.floor(DEVICE_REQUEST_TTL_MS / 1000),
      };
    },
  );

  app.post(
    '/token',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { deviceCode } = z.object({ deviceCode: z.string().min(20) }).parse(request.body);
      const deviceCodeHash = sha256(deviceCode);
      const deadline = Date.now() + LONG_POLL_MS;

      for (;;) {
        const [pending] = await db
          .select()
          .from(schema.cliDeviceRequests)
          .where(eq(schema.cliDeviceRequests.deviceCodeHash, deviceCodeHash))
          .limit(1);

        if (!pending) throw badRequest('This sign-in request does not exist');

        if (pending.status === 'denied') {
          throw new HttpError(403, 'access_denied', 'The request was declined in the browser');
        }

        if (pending.status === 'consumed') {
          throw new HttpError(410, 'already_used', 'This sign-in request was already completed');
        }

        if (pending.status === 'approved' && pending.userId && pending.scope) {
          const claimed = await db
            .update(schema.cliDeviceRequests)
            .set({ status: 'consumed' })
            .where(
              and(
                eq(schema.cliDeviceRequests.id, pending.id),
                eq(schema.cliDeviceRequests.status, 'approved'),
              ),
            )
            .returning({ id: schema.cliDeviceRequests.id });

          if (claimed.length === 0) {
            throw new HttpError(410, 'already_used', 'This sign-in request was already completed');
          }

          const host = pending.hostname ? ` on ${pending.hostname}` : '';
          const session = await createSession(
            db,
            pending.userId,
            {
              userAgent: `${pending.clientName} (${pending.platform ?? 'unknown platform'})`,
              ipAddress: request.ip ?? null,
              deviceName: `${pending.clientName}${host}`,
            },
            env.REFRESH_TOKEN_TTL_SECONDS,
            { kind: 'cli', scope: pending.scope as CliScope },
          );

          await db
            .update(schema.cliDeviceRequests)
            .set({ sessionId: session.sessionId })
            .where(eq(schema.cliDeviceRequests.id, pending.id));

          const [user] = await db
            .select({ email: schema.users.email, displayName: schema.users.displayName })
            .from(schema.users)
            .where(eq(schema.users.id, pending.userId))
            .limit(1);

          return {
            status: 'approved',
            user,
            ...(await issueTokens(
              pending.userId,
              session.sessionId,
              session.refreshToken,
              session.expiresAt,
            )),
          };
        }

        if (pending.expiresAt.getTime() < Date.now()) {
          throw new HttpError(
            410,
            'expired',
            'This sign-in request expired. Run collaby setup again.',
          );
        }

        if (Date.now() >= deadline) {
          reply.code(202);
          return { status: 'pending' };
        }

        await sleep(POLL_STEP_MS);
      }
    },
  );

  app.post(
    '/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } },
    async (request) => {
      const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(request.body);

      const result = await rotateSession(
        db,
        refreshToken,
        { userAgent: null, ipAddress: request.ip ?? null },
        env.REFRESH_TOKEN_TTL_SECONDS,
        { kind: 'cli', graceSeconds: REFRESH_GRACE_SECONDS, reuseRevokes: 'session' },
      );

      if (result.status !== 'ok') {
        throw unauthorized(
          result.status === 'reused'
            ? 'This CLI session was ended because its credentials were used twice. Run collaby setup again.'
            : 'This CLI session is no longer valid. Run collaby setup again.',
        );
      }

      return issueTokens(
        result.userId,
        result.session.sessionId,
        result.session.refreshToken,
        result.session.expiresAt,
      );
    },
  );

  app.get('/whoami', async (request) => {
    const auth = await requireCli(request);

    const [user] = await db
      .select({ email: schema.users.email, displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId))
      .limit(1);

    const manifest = await buildManifest(db, auth.userId, auth.scope);
    const workspaces = [...new Set(manifest.documents.map((document) => document.workspaceName))];

    return { user, scope: auth.scope, workspaces, documentCount: manifest.documents.length };
  });

  app.get('/manifest', async (request) => {
    const auth = await requireCli(request);
    return buildManifest(db, auth.userId, auth.scope);
  });

  app.post('/documents', async (request) => {
    const auth = await requireCli(request);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(request.body);
    return { documents: await readScopedMarkdown(db, auth.userId, auth.scope, ids) };
  });

  app.get('/wait', async (request) => {
    const auth = await requireCli(request);
    const { cursor } = z.object({ cursor: z.string().max(64) }).parse(request.query);
    const deadline = Date.now() + LONG_POLL_MS;

    for (;;) {
      const manifest = await buildManifest(db, auth.userId, auth.scope);
      if (manifest.cursor !== cursor) return { changed: true, cursor: manifest.cursor };
      if (Date.now() >= deadline) return { changed: false, cursor };

      await sleep(WAIT_STEP_MS);

      if (!(await loadActiveCliSession(db, auth.sessionId))) {
        throw unauthorized('This CLI session was signed out');
      }
    }
  });

  app.post('/logout', async (request, reply) => {
    const auth = await requireCli(request);
    await revokeSession(db, auth.userId, auth.sessionId, 'cli_logout');
    reply.code(204);
    return null;
  });

  app.get(
    '/requests/:userCode',
    { config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } },
    async (request) => {
      app.requireAuth(request);
      const { userCode } = userCodeSchema.parse(request.params);

      const [pending] = await db
        .select()
        .from(schema.cliDeviceRequests)
        .where(
          and(
            eq(schema.cliDeviceRequests.userCode, userCode),
            eq(schema.cliDeviceRequests.status, 'pending'),
            gt(schema.cliDeviceRequests.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!pending) throw notFound('No sign-in request is waiting for that code');

      return {
        userCode: pending.userCode,
        clientName: pending.clientName,
        hostname: pending.hostname,
        platform: pending.platform,
        ipAddress: pending.ipAddress,
        createdAt: pending.createdAt.toISOString(),
        expiresAt: pending.expiresAt.toISOString(),
      };
    },
  );

  app.post('/requests/:userCode/approve', async (request) => {
    const auth = app.requireAuth(request);
    const { userCode } = userCodeSchema.parse(request.params);
    const { scope } = z.object({ scope: scopeSchema }).parse(request.body);

    const problem = await validateScope(db, auth.userId, scope);
    if (problem) throw badRequest(problem);

    const approved = await db
      .update(schema.cliDeviceRequests)
      .set({ status: 'approved', userId: auth.userId, scope, decidedAt: new Date() })
      .where(
        and(
          eq(schema.cliDeviceRequests.userCode, userCode),
          eq(schema.cliDeviceRequests.status, 'pending'),
          gt(schema.cliDeviceRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: schema.cliDeviceRequests.id });

    if (approved.length === 0) throw notFound('No sign-in request is waiting for that code');
    return { approved: true };
  });

  app.post('/requests/:userCode/deny', async (request) => {
    app.requireAuth(request);
    const { userCode } = userCodeSchema.parse(request.params);

    const denied = await db
      .update(schema.cliDeviceRequests)
      .set({ status: 'denied', decidedAt: new Date() })
      .where(
        and(
          eq(schema.cliDeviceRequests.userCode, userCode),
          eq(schema.cliDeviceRequests.status, 'pending'),
        ),
      )
      .returning({ id: schema.cliDeviceRequests.id });

    if (denied.length === 0) throw notFound('No sign-in request is waiting for that code');
    return { denied: true };
  });
}
