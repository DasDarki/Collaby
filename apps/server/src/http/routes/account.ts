import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, schema } from '@collaby/db';
import {
  displayNameSchema,
  passkeyRegistrationFinishSchema,
  passwordSchema,
  totpCodeSchema,
  type PasskeySummary,
} from '@collaby/shared';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { AppContext } from '../../context.js';
import { decryptSecret, encryptSecret } from '../../auth/crypto.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { listSessions, revokeAllSessions, revokeSession } from '../../auth/sessions.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpProvisioningUri,
  verifyTotpCode,
} from '../../auth/totp.js';
import { buildRegistrationOptions, verifyRegistration } from '../../auth/webauthn.js';
import { badRequest, notFound, unauthorized } from '../errors.js';

const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  avatarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Avatar color must be a hex value')
    .optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200).nullable(),
  newPassword: passwordSchema,
});

const idParamSchema = z.object({ id: z.string().uuid() });

export default async function accountRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db, env } = context;

  const webauthnConfig = {
    rpId: env.webauthnRpId,
    rpName: env.WEBAUTHN_RP_NAME,
    origins: env.webauthnOrigins,
  };

  app.get('/me', async (request) => {
    const auth = app.requireAuth(request);
    const user = await app.loadUser(auth.userId);
    if (!user) throw notFound('Account not found');

    const [details] = await db
      .select({
        totpEnabledAt: schema.users.totpEnabledAt,
        passwordHash: schema.users.passwordHash,
      })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId))
      .limit(1);

    return {
      ...user,
      twoFactorEnabled: Boolean(details?.totpEnabledAt),
      hasPassword: Boolean(details?.passwordHash),
      sessionId: auth.sessionId,
    };
  });

  app.patch('/me', async (request) => {
    const auth = app.requireAuth(request);
    const input = updateProfileSchema.parse(request.body);

    if (Object.keys(input).length === 0) throw badRequest('Nothing to update');

    await db
      .update(schema.users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.users.id, auth.userId));

    return app.loadUser(auth.userId);
  });

  app.post('/password', async (request, reply) => {
    const auth = app.requireAuth(request);
    const input = changePasswordSchema.parse(request.body);

    const [user] = await db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId))
      .limit(1);

    if (!user) throw notFound('Account not found');

    if (user.passwordHash) {
      if (
        !input.currentPassword ||
        !(await verifyPassword(user.passwordHash, input.currentPassword))
      ) {
        throw unauthorized('Current password is incorrect');
      }
    }

    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() })
      .where(eq(schema.users.id, auth.userId));

    await revokeAllSessions(db, auth.userId, auth.sessionId, 'password_changed');

    reply.code(204);
    return null;
  });

  app.get('/sessions', async (request) => {
    const auth = app.requireAuth(request);
    return listSessions(db, auth.userId, auth.sessionId);
  });

  app.delete('/sessions/:id', async (request, reply) => {
    const auth = app.requireAuth(request);
    const { id } = idParamSchema.parse(request.params);

    const revoked = await revokeSession(db, auth.userId, id);
    if (!revoked) throw notFound('Session not found');

    reply.code(204);
    return null;
  });

  app.post('/sessions/revoke-others', async (request) => {
    const auth = app.requireAuth(request);
    const revoked = await revokeAllSessions(db, auth.userId, auth.sessionId);
    return { revoked };
  });

  app.post('/sessions/revoke-all', async (request, reply) => {
    const auth = app.requireAuth(request);
    const revoked = await revokeAllSessions(db, auth.userId);
    reply.code(200);
    return { revoked };
  });

  app.get('/passkeys', async (request) => {
    const auth = app.requireAuth(request);

    const rows = await db
      .select()
      .from(schema.passkeys)
      .where(eq(schema.passkeys.userId, auth.userId))
      .orderBy(schema.passkeys.createdAt);

    return rows.map((row): PasskeySummary => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      deviceType: row.deviceType,
      backedUp: row.backedUp,
    }));
  });

  app.post('/passkeys/register/start', async (request) => {
    const auth = app.requireAuth(request);
    const user = await app.loadUser(auth.userId);
    if (!user) throw notFound('Account not found');

    const existing = await db
      .select({
        credentialId: schema.passkeys.credentialId,
        publicKey: schema.passkeys.publicKey,
        counter: schema.passkeys.counter,
        transports: schema.passkeys.transports,
      })
      .from(schema.passkeys)
      .where(eq(schema.passkeys.userId, auth.userId));

    const options = await buildRegistrationOptions(webauthnConfig, user, existing);

    const [challenge] = await db
      .insert(schema.webauthnChallenges)
      .values({
        userId: auth.userId,
        kind: 'registration',
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
      })
      .returning({ id: schema.webauthnChallenges.id });

    if (!challenge) throw new Error('Failed to store WebAuthn challenge');

    return { challengeId: challenge.id, options };
  });

  app.post('/passkeys/register/finish', async (request, reply) => {
    const auth = app.requireAuth(request);
    const input = passkeyRegistrationFinishSchema.parse(request.body);

    const [challenge] = await db
      .select()
      .from(schema.webauthnChallenges)
      .where(
        and(
          eq(schema.webauthnChallenges.userId, auth.userId),
          eq(schema.webauthnChallenges.kind, 'registration'),
        ),
      )
      .orderBy(schema.webauthnChallenges.createdAt)
      .limit(1);

    if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
      throw badRequest('This passkey registration expired, please try again');
    }

    await db
      .delete(schema.webauthnChallenges)
      .where(eq(schema.webauthnChallenges.id, challenge.id));

    const credential = await verifyRegistration(
      webauthnConfig,
      challenge.challenge,
      input.response as unknown as RegistrationResponseJSON,
    );

    if (!credential) throw badRequest('Passkey registration could not be verified');

    const [created] = await db
      .insert(schema.passkeys)
      .values({
        userId: auth.userId,
        label: input.label,
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credential.deviceType,
        backedUp: credential.backedUp,
      })
      .returning({ id: schema.passkeys.id, createdAt: schema.passkeys.createdAt });

    if (!created) throw new Error('Failed to store passkey');

    reply.code(201);
    return {
      id: created.id,
      label: input.label,
      createdAt: created.createdAt.toISOString(),
      lastUsedAt: null,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
    } satisfies PasskeySummary;
  });

  app.patch('/passkeys/:id', async (request) => {
    const auth = app.requireAuth(request);
    const { id } = idParamSchema.parse(request.params);
    const { label } = z.object({ label: z.string().trim().min(1).max(80) }).parse(request.body);

    const updated = await db
      .update(schema.passkeys)
      .set({ label })
      .where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.userId, auth.userId)))
      .returning({ id: schema.passkeys.id });

    if (updated.length === 0) throw notFound('Passkey not found');
    return { id, label };
  });

  app.delete('/passkeys/:id', async (request, reply) => {
    const auth = app.requireAuth(request);
    const { id } = idParamSchema.parse(request.params);

    const removed = await db
      .delete(schema.passkeys)
      .where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.userId, auth.userId)))
      .returning({ id: schema.passkeys.id });

    if (removed.length === 0) throw notFound('Passkey not found');

    reply.code(204);
    return null;
  });

  app.post('/2fa/setup', async (request) => {
    const auth = app.requireAuth(request);
    const user = await app.loadUser(auth.userId);
    if (!user) throw notFound('Account not found');

    const secret = generateTotpSecret();

    await db
      .update(schema.users)
      .set({ totpSecret: encryptSecret(secret, env.SECRET_ENCRYPTION_KEY), totpEnabledAt: null })
      .where(eq(schema.users.id, auth.userId));

    return {
      secret,
      provisioningUri: totpProvisioningUri(secret, user.email, env.WEBAUTHN_RP_NAME),
    };
  });

  app.post('/2fa/enable', async (request) => {
    const auth = app.requireAuth(request);
    const { code } = z.object({ code: totpCodeSchema }).parse(request.body);

    const [user] = await db
      .select({ totpSecret: schema.users.totpSecret })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId))
      .limit(1);

    if (!user?.totpSecret) throw badRequest('Start the two-factor setup first');

    const secret = decryptSecret(user.totpSecret, env.SECRET_ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, code)) throw badRequest('That code is not valid');

    const recoveryCodes = generateRecoveryCodes();

    await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, auth.userId));
    await db.insert(schema.recoveryCodes).values(
      recoveryCodes.map((value) => ({
        userId: auth.userId,
        codeHash: hashRecoveryCode(value),
      })),
    );

    await db
      .update(schema.users)
      .set({ totpEnabledAt: new Date() })
      .where(eq(schema.users.id, auth.userId));

    return { recoveryCodes };
  });

  app.post('/2fa/disable', async (request, reply) => {
    const auth = app.requireAuth(request);
    const { code } = z.object({ code: totpCodeSchema }).parse(request.body);

    const [user] = await db
      .select({ totpSecret: schema.users.totpSecret, totpEnabledAt: schema.users.totpEnabledAt })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId))
      .limit(1);

    if (!user?.totpSecret || !user.totpEnabledAt) {
      throw badRequest('Two-factor authentication is not enabled');
    }

    const secret = decryptSecret(user.totpSecret, env.SECRET_ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, code)) throw badRequest('That code is not valid');

    await db
      .update(schema.users)
      .set({ totpSecret: null, totpEnabledAt: null })
      .where(eq(schema.users.id, auth.userId));
    await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, auth.userId));

    reply.code(204);
    return null;
  });

  app.post('/2fa/recovery-codes', async (request) => {
    const auth = app.requireAuth(request);
    const { code } = z.object({ code: totpCodeSchema }).parse(request.body);

    const [user] = await db
      .select({ totpSecret: schema.users.totpSecret, totpEnabledAt: schema.users.totpEnabledAt })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId))
      .limit(1);

    if (!user?.totpSecret || !user.totpEnabledAt) {
      throw badRequest('Two-factor authentication is not enabled');
    }

    const secret = decryptSecret(user.totpSecret, env.SECRET_ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, code)) throw badRequest('That code is not valid');

    const recoveryCodes = generateRecoveryCodes();
    await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, auth.userId));
    await db.insert(schema.recoveryCodes).values(
      recoveryCodes.map((value) => ({
        userId: auth.userId,
        codeHash: hashRecoveryCode(value),
      })),
    );

    return { recoveryCodes };
  });
}
