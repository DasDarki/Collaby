import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, schema } from '@collaby/db';
import {
  loginSchema,
  passkeyAuthenticationFinishSchema,
  registerSchema,
  twoFactorChallengeSchema,
  type TwoFactorRequired,
} from '@collaby/shared';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { AppContext } from '../../context.js';
import { randomToken, sha256, decryptSecret } from '../../auth/crypto.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { createSession, revokeSession, rotateSession } from '../../auth/sessions.js';
import { hashRecoveryCode, verifyTotpCode } from '../../auth/totp.js';
import { buildAuthenticationOptions, verifyAuthentication } from '../../auth/webauthn.js';
import { createAuthorizationRequest, exchangeAuthorizationCode } from '../../auth/oidc.js';
import { avatarColorFor, findUserByEmail } from '../../services/users.js';
import { createWorkspace } from '../../services/workspaces.js';
import {
  REFRESH_COOKIE_NAME,
  buildAuthResult,
  clearRefreshCookie,
  setRefreshCookie,
} from '../session-response.js';
import { badRequest, forbidden, unauthorized } from '../errors.js';

const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const STRICT_RATE_LIMIT = {
  config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
};

const MODERATE_RATE_LIMIT = {
  config: { rateLimit: { max: 60, timeWindow: '5 minutes' } },
};
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const OAUTH_STATE_COOKIE = 'collaby_oauth';

function requestContext(request: FastifyRequest) {
  return {
    userAgent: request.headers['user-agent'] ?? null,
    ipAddress: request.ip ?? null,
  };
}

export default async function authRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const { db, env } = context;

  async function completeLogin(request: FastifyRequest, reply: FastifyReply, userId: string) {
    const session = await createSession(
      db,
      userId,
      requestContext(request),
      env.REFRESH_TOKEN_TTL_SECONDS,
    );
    setRefreshCookie(reply, context, session);
    return buildAuthResult(context, userId, session);
  }

  app.get('/providers', async () => ({
    oidc: env.oidc ? { name: env.oidc.name } : null,
    passkeys: true,
    registration: env.ALLOW_REGISTRATION,
  }));

  app.post('/register', STRICT_RATE_LIMIT, async (request, reply) => {
    if (!env.ALLOW_REGISTRATION) {
      throw forbidden('Registration is disabled on this instance');
    }

    const input = registerSchema.parse(request.body);
    const existing = await findUserByEmail(db, input.email);
    if (existing) throw badRequest('An account with this email already exists');

    const [user] = await db
      .insert(schema.users)
      .values({
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        avatarColor: avatarColorFor(input.email),
      })
      .returning({ id: schema.users.id });

    if (!user) throw new Error('Failed to create user');

    await createWorkspace(db, user.id, `${input.displayName}'s workspace`, 'personal');

    reply.code(201);
    return completeLogin(request, reply, user.id);
  });

  app.post('/login', STRICT_RATE_LIMIT, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await findUserByEmail(db, input.email);

    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
      throw unauthorized('Email or password is incorrect');
    }

    if (user.totpEnabledAt) {
      const challengeToken = randomToken(32);
      await db.insert(schema.twoFactorChallenges).values({
        userId: user.id,
        tokenHash: sha256(challengeToken),
        userAgent: request.headers['user-agent'] ?? null,
        ipAddress: request.ip ?? null,
        expiresAt: new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS),
      });

      return { status: 'two_factor_required', challengeToken } satisfies TwoFactorRequired;
    }

    return completeLogin(request, reply, user.id);
  });

  app.post('/2fa/verify', STRICT_RATE_LIMIT, async (request, reply) => {
    const input = twoFactorChallengeSchema.parse(request.body);

    const [challenge] = await db
      .select()
      .from(schema.twoFactorChallenges)
      .where(
        and(
          eq(schema.twoFactorChallenges.tokenHash, sha256(input.challengeToken)),
          isNull(schema.twoFactorChallenges.consumedAt),
        ),
      )
      .limit(1);

    if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
      throw unauthorized('This verification request expired, please sign in again');
    }

    const [user] = await db
      .select({ id: schema.users.id, totpSecret: schema.users.totpSecret })
      .from(schema.users)
      .where(eq(schema.users.id, challenge.userId))
      .limit(1);

    if (!user?.totpSecret) throw unauthorized('Two-factor authentication is not configured');

    const secret = decryptSecret(user.totpSecret, env.SECRET_ENCRYPTION_KEY);
    let accepted = verifyTotpCode(secret, input.code);

    if (!accepted) {
      const consumed = await db
        .update(schema.recoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(schema.recoveryCodes.userId, user.id),
            eq(schema.recoveryCodes.codeHash, hashRecoveryCode(input.code)),
            isNull(schema.recoveryCodes.usedAt),
          ),
        )
        .returning({ id: schema.recoveryCodes.id });

      accepted = consumed.length > 0;
    }

    if (!accepted) throw unauthorized('That code is not valid');

    await db
      .update(schema.twoFactorChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(schema.twoFactorChallenges.id, challenge.id));

    return completeLogin(request, reply, user.id);
  });

  app.post('/refresh', MODERATE_RATE_LIMIT, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (!token) throw unauthorized('No refresh token present');

    const result = await rotateSession(
      db,
      token,
      requestContext(request),
      env.REFRESH_TOKEN_TTL_SECONDS,
    );

    if (result.status !== 'ok') {
      clearRefreshCookie(reply, context);
      if (result.status === 'reused') {
        throw unauthorized('This session was ended for security reasons, please sign in again');
      }
      throw unauthorized('Your session expired, please sign in again');
    }

    setRefreshCookie(reply, context, result.session);
    return buildAuthResult(context, result.userId, result.session);
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    clearRefreshCookie(reply, context);

    if (token) {
      const [session] = await db
        .select({ id: schema.sessions.id, userId: schema.sessions.userId })
        .from(schema.sessions)
        .where(eq(schema.sessions.refreshTokenHash, sha256(token)))
        .limit(1);

      if (session) await revokeSession(db, session.userId, session.id, 'logout');
    }

    reply.code(204);
    return null;
  });

  app.post('/passkey/login/start', MODERATE_RATE_LIMIT, async () => {
    const options = await buildAuthenticationOptions({
      rpId: env.webauthnRpId,
      rpName: env.WEBAUTHN_RP_NAME,
      origins: env.webauthnOrigins,
    });

    const [challenge] = await db
      .insert(schema.webauthnChallenges)
      .values({
        kind: 'authentication',
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
      })
      .returning({ id: schema.webauthnChallenges.id });

    if (!challenge) throw new Error('Failed to store WebAuthn challenge');

    return { challengeId: challenge.id, options };
  });

  app.post('/passkey/login/finish', STRICT_RATE_LIMIT, async (request, reply) => {
    const input = passkeyAuthenticationFinishSchema.parse(request.body);
    const response = input.response as unknown as AuthenticationResponseJSON;

    const [challenge] = await db
      .select()
      .from(schema.webauthnChallenges)
      .where(
        and(
          eq(schema.webauthnChallenges.id, input.challengeId),
          eq(schema.webauthnChallenges.kind, 'authentication'),
        ),
      )
      .limit(1);

    if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
      throw unauthorized('This passkey request expired, please try again');
    }

    await db
      .delete(schema.webauthnChallenges)
      .where(eq(schema.webauthnChallenges.id, challenge.id));

    const [passkey] = await db
      .select()
      .from(schema.passkeys)
      .where(eq(schema.passkeys.credentialId, response.id))
      .limit(1);

    if (!passkey) throw unauthorized('This passkey is not registered');

    const verification = await verifyAuthentication(
      {
        rpId: env.webauthnRpId,
        rpName: env.WEBAUTHN_RP_NAME,
        origins: env.webauthnOrigins,
      },
      challenge.challenge,
      {
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      },
      response,
    );

    if (!verification) throw unauthorized('Passkey verification failed');

    await db
      .update(schema.passkeys)
      .set({ counter: verification.newCounter, lastUsedAt: new Date() })
      .where(eq(schema.passkeys.id, passkey.id));

    return completeLogin(request, reply, passkey.userId);
  });

  const oidc = env.oidc;

  if (oidc) {
    const oidcConfig = {
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
      scopes: oidc.scopes,
      redirectUri: `${env.PUBLIC_API_URL}/api/auth/oidc/callback`,
    };

    function loginError(reason: string): string {
      return `${env.PUBLIC_WEB_URL}/login?error=${reason}`;
    }

    app.get('/oidc/start', async (request, reply) => {
      let authorization;

      try {
        authorization = await createAuthorizationRequest(oidcConfig);
      } catch (error) {
        request.log.error({ err: error }, 'Could not start the single sign-on flow');
        return reply.redirect(loginError('sso_unavailable'));
      }

      reply.setCookie(
        OAUTH_STATE_COOKIE,
        JSON.stringify({
          state: authorization.state,
          codeVerifier: authorization.codeVerifier,
          nonce: authorization.nonce,
        }),
        {
          httpOnly: true,
          secure: env.cookieSecure,
          sameSite: 'lax',
          path: '/api/auth',
          maxAge: 600,
        },
      );

      return reply.redirect(authorization.url);
    });

    app.get('/oidc/callback', async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };
      const raw = request.cookies[OAUTH_STATE_COOKIE];

      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth' });

      if (query.error || !query.code || !query.state || !raw) {
        return reply.redirect(loginError('sso'));
      }

      const stored = JSON.parse(raw) as {
        state: string;
        codeVerifier: string | null;
        nonce: string;
      };

      if (stored.state !== query.state) {
        return reply.redirect(loginError('sso_state'));
      }

      let profile;

      try {
        profile = await exchangeAuthorizationCode(
          oidcConfig,
          query.code,
          stored.codeVerifier,
          stored.nonce,
        );
      } catch (error) {
        request.log.error({ err: error }, 'Single sign-on failed');
        return reply.redirect(loginError('sso'));
      }

      if (!profile.emailVerified) {
        return reply.redirect(loginError('sso_unverified'));
      }

      const [linked] = await db
        .select({ userId: schema.oauthAccounts.userId })
        .from(schema.oauthAccounts)
        .where(
          and(
            eq(schema.oauthAccounts.provider, profile.issuer),
            eq(schema.oauthAccounts.providerAccountId, profile.subject),
          ),
        )
        .limit(1);

      let userId = linked?.userId ?? null;

      if (!userId) {
        const existing = await findUserByEmail(db, profile.email);

        if (existing) {
          userId = existing.id;
        } else {
          if (!env.ALLOW_REGISTRATION) {
            return reply.redirect(loginError('registration_disabled'));
          }

          const displayName = profile.name ?? profile.email.split('@')[0]!;
          const [created] = await db
            .insert(schema.users)
            .values({
              email: profile.email,
              displayName,
              emailVerifiedAt: new Date(),
              avatarUrl: profile.picture,
              avatarColor: avatarColorFor(profile.email),
            })
            .returning({ id: schema.users.id });

          if (!created) throw new Error('Failed to create a user from the sign-on profile');
          userId = created.id;
          await createWorkspace(db, userId, `${displayName}'s workspace`, 'personal');
        }

        await db.insert(schema.oauthAccounts).values({
          userId,
          provider: profile.issuer,
          providerAccountId: profile.subject,
        });
      }

      const session = await createSession(
        db,
        userId,
        requestContext(request),
        env.REFRESH_TOKEN_TTL_SECONDS,
      );
      setRefreshCookie(reply, context, session);

      return reply.redirect(`${env.PUBLIC_WEB_URL}/auth/callback`);
    });
  }
}
