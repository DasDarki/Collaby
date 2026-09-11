import { and, eq, gt, inArray, isNull, type Database, schema, sql } from '@collaby/db';
import type { CliScope, SessionDevice, SessionKind } from '@collaby/shared';
import { randomToken, sha256 } from './crypto.js';
import { deviceNameFromUserAgent } from './device-name.js';

export interface SessionRequestContext {
  userAgent: string | null;
  ipAddress: string | null;
  deviceName?: string | undefined;
}

export interface SessionOptions {
  kind?: SessionKind;
  scope?: CliScope | null;
}

export interface RotationOptions {
  kind?: SessionKind;
  graceSeconds?: number;
  reuseRevokes?: 'account' | 'session';
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export type RotationResult =
  | { status: 'ok'; session: IssuedSession; userId: string; scope: CliScope | null }
  | { status: 'invalid' }
  | { status: 'reused' };

function expiryFrom(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}

export async function createSession(
  db: Database,
  userId: string,
  context: SessionRequestContext,
  ttlSeconds: number,
  options: SessionOptions = {},
): Promise<IssuedSession> {
  const refreshToken = randomToken(48);
  const expiresAt = expiryFrom(ttlSeconds);

  const [session] = await db
    .insert(schema.sessions)
    .values({
      userId,
      refreshTokenHash: sha256(refreshToken),
      deviceName: context.deviceName?.trim() || deviceNameFromUserAgent(context.userAgent),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt,
      kind: options.kind ?? 'browser',
      scope: options.scope ?? null,
    })
    .returning({ id: schema.sessions.id });

  if (!session) throw new Error('Failed to create session');

  return { sessionId: session.id, refreshToken, expiresAt };
}

export async function rotateSession(
  db: Database,
  refreshToken: string,
  context: SessionRequestContext,
  ttlSeconds: number,
  options: RotationOptions = {},
): Promise<RotationResult> {
  const kind = options.kind ?? 'browser';
  const graceSeconds = options.graceSeconds ?? 0;
  const presentedHash = sha256(refreshToken);
  const now = new Date();

  const [active] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.refreshTokenHash, presentedHash),
        eq(schema.sessions.kind, kind),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (active) {
    return issueRotation(db, active, presentedHash, context, ttlSeconds, true);
  }

  const [previous] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.previousRefreshTokenHash, presentedHash),
        eq(schema.sessions.kind, kind),
      ),
    )
    .limit(1);

  if (!previous) return { status: 'invalid' };

  const withinGrace =
    graceSeconds > 0 &&
    previous.revokedAt === null &&
    previous.expiresAt > now &&
    previous.rotatedAt !== null &&
    now.getTime() - previous.rotatedAt.getTime() <= graceSeconds * 1000;

  if (withinGrace) {
    return issueRotation(db, previous, presentedHash, context, ttlSeconds, false);
  }

  if (options.reuseRevokes === 'session') {
    await revokeSession(db, previous.userId, previous.id, 'refresh_token_reuse');
  } else {
    await revokeAllSessions(db, previous.userId, undefined, 'refresh_token_reuse');
  }

  return { status: 'reused' };
}

async function issueRotation(
  db: Database,
  session: typeof schema.sessions.$inferSelect,
  presentedHash: string,
  context: SessionRequestContext,
  ttlSeconds: number,
  restartGrace: boolean,
): Promise<RotationResult> {
  const nextToken = randomToken(48);
  const expiresAt = expiryFrom(ttlSeconds);

  await db
    .update(schema.sessions)
    .set({
      refreshTokenHash: sha256(nextToken),
      previousRefreshTokenHash: presentedHash,
      ...(restartGrace ? { rotatedAt: new Date() } : {}),
      lastSeenAt: new Date(),
      expiresAt,
      userAgent: context.userAgent ?? session.userAgent,
      ipAddress: context.ipAddress ?? session.ipAddress,
    })
    .where(eq(schema.sessions.id, session.id));

  return {
    status: 'ok',
    userId: session.userId,
    scope: (session.scope as CliScope | null) ?? null,
    session: { sessionId: session.id, refreshToken: nextToken, expiresAt },
  };
}

export async function revokeSession(
  db: Database,
  userId: string,
  sessionId: string,
  reason = 'user_revoked',
): Promise<boolean> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });

  return revoked.length > 0;
}

export async function revokeAllSessions(
  db: Database,
  userId: string,
  exceptSessionId?: string,
  reason = 'user_revoked_all',
): Promise<number> {
  const conditions = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
  if (exceptSessionId) {
    conditions.push(sql`${schema.sessions.id} <> ${exceptSessionId}`);
  }

  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(...conditions))
    .returning({ id: schema.sessions.id });

  return revoked.length;
}

export async function isSessionActive(
  db: Database,
  sessionId: string,
  kind: SessionKind = 'browser',
): Promise<boolean> {
  const [session] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.kind, kind),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return Boolean(session);
}

export async function loadActiveCliSession(
  db: Database,
  sessionId: string,
): Promise<{ userId: string; scope: CliScope } | null> {
  const [session] = await db
    .select({ userId: schema.sessions.userId, scope: schema.sessions.scope })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.kind, 'cli'),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session?.scope) return null;
  return { userId: session.userId, scope: session.scope as CliScope };
}

export async function touchSession(db: Database, sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}

async function describeScope(db: Database, scope: CliScope | null): Promise<string | null> {
  if (!scope) return null;
  if (scope.all) return 'Read access to all workspaces';

  const names: string[] = [];

  if (scope.workspaces.length > 0) {
    const rows = await db
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(inArray(schema.workspaces.id, scope.workspaces));
    names.push(...rows.map((row) => row.name));
  }

  if (scope.folders.length > 0) {
    const rows = await db
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(inArray(schema.documents.id, scope.folders));
    names.push(...rows.map((row) => row.title));
  }

  return names.length > 0 ? `Read access to ${names.join(', ')}` : 'Read access to nothing';
}

export async function listSessions(
  db: Database,
  userId: string,
  currentSessionId: string | null,
): Promise<SessionDevice[]> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(schema.sessions.lastSeenAt);

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      kind: row.kind === 'cli' ? ('cli' as const) : ('browser' as const),
      deviceName: row.deviceName,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      isCurrent: row.id === currentSessionId,
      scopeLabel: row.kind === 'cli' ? await describeScope(db, row.scope as CliScope | null) : null,
    })),
  );
}
