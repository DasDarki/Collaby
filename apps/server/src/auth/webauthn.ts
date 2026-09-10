import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

export interface StoredPasskey {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
}

export async function buildRegistrationOptions(
  config: WebAuthnConfig,
  user: { id: string; email: string; displayName: string },
  existing: StoredPasskey[],
) {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.displayName,
    attestationType: 'none',
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: (passkey.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'preferred',
    },
  });
}

export async function verifyRegistration(
  config: WebAuthnConfig,
  expectedChallenge: string,
  response: RegistrationResponseJSON,
) {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpId,
    requireUserVerification: false,
  });

  if (!verification.verified) return null;

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64'),
    counter: credential.counter,
    transports: credential.transports ?? null,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  };
}

export async function buildAuthenticationOptions(config: WebAuthnConfig) {
  return generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: 'preferred',
    allowCredentials: [],
  });
}

export async function verifyAuthentication(
  config: WebAuthnConfig,
  expectedChallenge: string,
  passkey: StoredPasskey,
  response: AuthenticationResponseJSON,
) {
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpId,
    requireUserVerification: false,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
      counter: passkey.counter,
      transports: (passkey.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  });

  if (!verification.verified) return null;
  return { newCounter: verification.authenticationInfo.newCounter };
}
