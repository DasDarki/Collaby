import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = new URL('https://www.googleapis.com/oauth2/v3/certs');
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const jwks = createRemoteJWKSet(JWKS_URI);

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleAuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}

function base64UrlEncode(input: Buffer): string {
  return input.toString('base64url');
}

export function createAuthorizationRequest(config: GoogleConfig): GoogleAuthorizationRequest {
  const state = base64UrlEncode(randomBytes(24));
  const nonce = base64UrlEncode(randomBytes(24));
  const codeVerifier = base64UrlEncode(randomBytes(48));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());

  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  return { url: url.toString(), state, codeVerifier, nonce };
}

export async function exchangeAuthorizationCode(
  config: GoogleConfig,
  code: string,
  codeVerifier: string,
  nonce: string,
): Promise<GoogleProfile> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) {
    throw new Error('Google token response did not contain an id_token');
  }

  const { payload: claims } = await jwtVerify(payload.id_token, jwks, {
    issuer: ISSUERS,
    audience: config.clientId,
  });

  if (claims.nonce !== nonce) {
    throw new Error('Google id_token nonce mismatch');
  }

  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw new Error('Google id_token is missing required claims');
  }

  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name : null,
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}
