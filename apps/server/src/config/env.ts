import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  DATABASE_URL: z.string().min(1),
  DATA_DIR: z.string().default('./data'),
  MIGRATIONS_DIR: optionalString,
  RUN_MIGRATIONS: booleanish.default(true),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SECRET_ENCRYPTION_KEY: z.string().min(32, 'SECRET_ENCRYPTION_KEY must be at least 32 characters'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  WEBAUTHN_RP_NAME: z.string().default('Collaby'),
  WEBAUTHN_RP_ID: optionalString,

  OIDC_ISSUER: optionalString,
  OIDC_CLIENT_ID: optionalString,
  OIDC_CLIENT_SECRET: optionalString,
  OIDC_SCOPES: z.string().default('openid email profile'),
  OIDC_PROVIDER_NAME: optionalString,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  ALLOW_REGISTRATION: booleanish.default(true),

  COOKIE_DOMAIN: optionalString,
  COOKIE_SAME_SITE: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
    z.enum(['lax', 'strict', 'none']).optional(),
  ),

  GIT_COMMIT_DEBOUNCE_MS: z.coerce.number().int().positive().default(30_000),
  GIT_AUTHOR_NAME: z.string().default('Collaby'),
  GIT_AUTHOR_EMAIL: z.string().default('bot@collaby.local'),

  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
});

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  name: string;
}

export type Env = z.infer<typeof envSchema> & {
  webauthnRpId: string;
  webauthnOrigins: string[];
  oidc: OidcSettings | null;
  isProduction: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  cookieSecure: boolean;
};

type RawEnv = z.infer<typeof envSchema>;

function displayNameFor(issuer: string, configured: string | undefined): string {
  if (configured) return configured;

  try {
    const host = new URL(issuer).hostname;
    if (host.endsWith('accounts.google.com')) return 'Google';
    const label = host.split('.')[0] ?? host;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return 'Single sign-on';
  }
}

function resolveOidc(env: RawEnv): OidcSettings | null {
  if (env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET) {
    return {
      issuer: env.OIDC_ISSUER.replace(/\/+$/, ''),
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      scopes: env.OIDC_SCOPES,
      name: displayNameFor(env.OIDC_ISSUER, env.OIDC_PROVIDER_NAME),
    };
  }

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return {
      issuer: 'https://accounts.google.com',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scopes: env.OIDC_SCOPES,
      name: env.OIDC_PROVIDER_NAME ?? 'Google',
    };
  }

  return null;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  const webUrl = new URL(env.PUBLIC_WEB_URL);
  const apiUrl = new URL(env.PUBLIC_API_URL);
  const origins = new Set([webUrl.origin]);

  const oidc = resolveOidc(env);

  const crossSite = webUrl.origin !== apiUrl.origin;
  const cookieSameSite = env.COOKIE_SAME_SITE ?? (crossSite ? 'none' : 'lax');

  return {
    ...env,
    webauthnRpId: env.WEBAUTHN_RP_ID || webUrl.hostname,
    webauthnOrigins: [...origins],
    oidc,
    isProduction: env.NODE_ENV === 'production',
    cookieSameSite,
    cookieSecure: cookieSameSite === 'none' || apiUrl.protocol === 'https:',
  };
}
