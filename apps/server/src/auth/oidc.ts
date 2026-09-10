import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
}

export interface OidcProfile {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface OidcAuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string | null;
}

interface DiscoveryDocument {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  supportsPkce: boolean;
  usesBasicAuth: boolean;
}

const discoveryCache = new Map<string, Promise<DiscoveryDocument>>();
const jwksCache = new Map<string, JWTVerifyGetKey>();

function base64Url(input: Buffer): string {
  return input.toString('base64url');
}

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}

async function fetchDiscovery(issuer: string): Promise<DiscoveryDocument> {
  const url = `${normalizeIssuer(issuer)}/.well-known/openid-configuration`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(
      `Could not read the OpenID configuration at ${url} (status ${response.status})`,
    );
  }

  const document = (await response.json()) as {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    jwks_uri?: string;
    code_challenge_methods_supported?: string[];
    token_endpoint_auth_methods_supported?: string[];
  };

  if (
    !document.issuer ||
    !document.authorization_endpoint ||
    !document.token_endpoint ||
    !document.jwks_uri
  ) {
    throw new Error(`The OpenID configuration at ${url} is missing required endpoints`);
  }

  const authMethods = document.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];

  return {
    issuer: document.issuer,
    authorizationEndpoint: document.authorization_endpoint,
    tokenEndpoint: document.token_endpoint,
    jwksUri: document.jwks_uri,
    supportsPkce: (document.code_challenge_methods_supported ?? []).includes('S256'),
    usesBasicAuth:
      !authMethods.includes('client_secret_post') && authMethods.includes('client_secret_basic'),
  };
}

export function discover(issuer: string): Promise<DiscoveryDocument> {
  const key = normalizeIssuer(issuer);
  let pending = discoveryCache.get(key);

  if (!pending) {
    pending = fetchDiscovery(key).catch((error: unknown) => {
      discoveryCache.delete(key);
      throw error;
    });
    discoveryCache.set(key, pending);
  }

  return pending;
}

function keySetFor(document: DiscoveryDocument): JWTVerifyGetKey {
  let keys = jwksCache.get(document.jwksUri);

  if (!keys) {
    keys = createRemoteJWKSet(new URL(document.jwksUri));
    jwksCache.set(document.jwksUri, keys);
  }

  return keys;
}

function acceptedIssuers(issuer: string): string[] {
  const withoutScheme = issuer.replace(/^https:\/\//, '');
  return issuer === withoutScheme ? [issuer] : [issuer, withoutScheme];
}

export async function createAuthorizationRequest(
  config: OidcConfig,
): Promise<OidcAuthorizationRequest> {
  const document = await discover(config.issuer);

  const state = base64Url(randomBytes(24));
  const nonce = base64Url(randomBytes(24));
  const codeVerifier = document.supportsPkce ? base64Url(randomBytes(48)) : null;

  const url = new URL(document.authorizationEndpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);

  if (codeVerifier) {
    url.searchParams.set(
      'code_challenge',
      base64Url(createHash('sha256').update(codeVerifier).digest()),
    );
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return { url: url.toString(), state, nonce, codeVerifier };
}

export async function exchangeAuthorizationCode(
  config: OidcConfig,
  code: string,
  codeVerifier: string | null,
  nonce: string,
): Promise<OidcProfile> {
  const document = await discover(config.issuer);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };

  if (document.usesBasicAuth) {
    const credentials = Buffer.from(
      `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
    ).toString('base64');
    headers.authorization = `Basic ${credentials}`;
  } else {
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret);
  }

  if (codeVerifier) body.set('code_verifier', codeVerifier);

  const response = await fetch(document.tokenEndpoint, { method: 'POST', headers, body });

  if (!response.ok) {
    throw new Error(`The identity provider rejected the token exchange (${response.status})`);
  }

  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) {
    throw new Error('The identity provider did not return an id_token');
  }

  const { payload: claims } = await jwtVerify(payload.id_token, keySetFor(document), {
    issuer: acceptedIssuers(document.issuer),
    audience: config.clientId,
  });

  if (claims.nonce !== nonce) {
    throw new Error('The id_token nonce did not match the request');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('The id_token is missing a subject');
  }

  if (typeof claims.email !== 'string' || claims.email.length === 0) {
    throw new Error(
      'The identity provider did not return an email address. Make sure the email scope is granted.',
    );
  }

  return {
    issuer: document.issuer,
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified !== false,
    name:
      typeof claims.name === 'string'
        ? claims.name
        : typeof claims.nickname === 'string'
          ? claims.nickname
          : null,
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}
