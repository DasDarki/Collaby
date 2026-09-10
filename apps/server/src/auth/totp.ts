import { Secret, TOTP } from 'otpauth';
import { randomBytes } from 'node:crypto';
import { sha256 } from './crypto.js';

const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_LENGTH = 16;
const RECOVERY_CODE_COUNT = 10;

function buildTotp(secret: string, accountLabel: string, issuer: string): TOTP {
  return new TOTP({
    issuer,
    label: accountLabel,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpProvisioningUri(secret: string, accountLabel: string, issuer: string): string {
  return buildTotp(secret, accountLabel, issuer).toString();
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const delta = buildTotp(secret, 'collaby', 'Collaby').validate({ token: code, window: 1 });
  return delta !== null;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(RECOVERY_CODE_LENGTH);
    const characters = Array.from(bytes, (byte) => {
      const index = byte % RECOVERY_CODE_ALPHABET.length;
      return RECOVERY_CODE_ALPHABET.charAt(index);
    }).join('');
    return `${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8, 12)}-${characters.slice(12, 16)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return sha256(normalizeRecoveryCode(code));
}
