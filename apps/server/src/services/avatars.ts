import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const AVATAR_MIME_TYPES = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function avatarsRoot(dataDir: string): string {
  return resolve(dataDir, 'avatars');
}

export function avatarPath(dataDir: string, key: string, extension: string): string {
  return join(avatarsRoot(dataDir), `${key}${extension}`);
}

export async function writeAvatar(
  dataDir: string,
  key: string,
  extension: string,
  data: Buffer,
): Promise<void> {
  await mkdir(avatarsRoot(dataDir), { recursive: true });
  await writeFile(avatarPath(dataDir, key, extension), data);
}

export async function removeAvatar(dataDir: string, url: string | null): Promise<void> {
  const key = avatarKeyFromUrl(url);
  if (!key) return;

  for (const extension of AVATAR_MIME_TYPES.values()) {
    await rm(avatarPath(dataDir, key, extension), { force: true });
  }
}

export function avatarKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^\/api\/avatars\/([A-Za-z0-9_-]{16,64})$/.exec(url);
  return match?.[1] ?? null;
}

export async function openAvatar(
  dataDir: string,
  key: string,
): Promise<{ stream: ReturnType<typeof createReadStream>; size: number; mimeType: string } | null> {
  for (const [mimeType, extension] of AVATAR_MIME_TYPES) {
    const path = avatarPath(dataDir, key, extension);
    const info = await stat(path).catch(() => null);
    if (info) return { stream: createReadStream(path), size: info.size, mimeType };
  }

  return null;
}
