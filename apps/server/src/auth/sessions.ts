import { and, eq, gt, isNull, type Database, schema, sql } from '@collaby/db';
import type { SessionDevice } from '@collaby/shared';
import { randomToken, sha256 } from './crypto.js';
import { deviceNameFromUserAgent } from './device-name.js';

export interface SessionRequestContext {
  userAgent: string | null;
  ipAddress: string | null;
  deviceName?: string | undefined;
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export type RotationResult =
  | { status: 'ok'; session: IssuedSession; userId: string }
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
): Promise<RotationResult> {
  const presentedHash = sha256(refreshToken);

  const [active] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.refreshTokenHash, presentedHash),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!active) {
    const [reused] = await db
      .select({ id: schema.sessions.id, userId: schema.sessions.userId })
      .from(schema.sessions)
      .where(eq(schema.sessions.previousRefreshTokenHash, presentedHash))
      .limit(1);

    if (reused) {
      await revokeAllSessions(db, reused.userId, undefined, 'refresh_token_reuse');
      return { status: 'reused' };
    }

    return { status: 'invalid' };
  }

  const nextToken = randomToken(48);
  const expiresAt = expiryFrom(ttlSeconds);

  await db
    .update(schema.sessions)
    .set({
      refreshTokenHash: sha256(nextToken),
      previousRefreshTokenHash: presentedHash,
      rotatedAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt,
      userAgent: context.userAgent ?? active.userAgent,
      ipAddress: context.ipAddress ?? active.ipAddress,
    })
    .where(eq(schema.sessions.id, active.id));

  return {
    status: 'ok',
    userId: active.userId,
    session: { sessionId: active.id, refreshToken: nextToken, expiresAt },
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

export async function isSessionActive(db: Database, sessionId: string): Promise<boolean> {
  const [session] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return Boolean(session);
}

export async function touchSession(db: Database, sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
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

  return rows.map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    isCurrent: row.id === currentSessionId,
  }));
}
