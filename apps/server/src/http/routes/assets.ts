import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, schema } from '@collaby/db';
import type { AppContext } from '../../context.js';
import { randomToken } from '../../auth/crypto.js';
import { openAvatar } from '../../services/avatars.js';
import { requireDocumentAccess } from '../guards.js';
import { badRequest, notFound } from '../errors.js';

const ALLOWED_MIME_TYPES = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  ['image/svg+xml', '.svg'],
]);

const documentParamSchema = z.object({ id: z.string().uuid() });
const assetParamSchema = z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

export default async function assetRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db, env } = context;
  const assetsRoot = resolve(env.DATA_DIR, 'assets');

  app.post('/documents/:id/assets', async (request, reply) => {
    const { id } = documentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);
    const access = await requireDocumentAccess(context, request, id, 'document.edit');

    const upload = await request.file({ limits: { fileSize: env.MAX_UPLOAD_BYTES } });
    if (!upload) throw badRequest('No file was uploaded');

    const extension = ALLOWED_MIME_TYPES.get(upload.mimetype);
    if (!extension) {
      throw badRequest('Only PNG, JPEG, GIF, WebP, AVIF and SVG images can be uploaded');
    }

    const buffer = await upload.toBuffer();
    if (buffer.byteLength === 0) throw badRequest('The uploaded file is empty');

    const storageKey = randomToken(24);
    const directory = join(assetsRoot, access.document.workspaceId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${storageKey}${extension}`), buffer);

    const [asset] = await db
      .insert(schema.assets)
      .values({
        workspaceId: access.document.workspaceId,
        documentId: id,
        uploaderId: auth.userId,
        filename: upload.filename || `image${extension}`,
        mimeType: upload.mimetype,
        byteSize: buffer.byteLength,
        storageKey,
      })
      .returning({ id: schema.assets.id });

    if (!asset) throw new Error('Failed to record the uploaded asset');

    reply.code(201);
    return {
      id: asset.id,
      url: `/api/assets/${storageKey}`,
      filename: upload.filename,
      byteSize: buffer.byteLength,
    };
  });

  app.get('/avatars/:key', async (request, reply) => {
    const { key } = assetParamSchema.parse(request.params);

    const avatar = await openAvatar(env.DATA_DIR, key);
    if (!avatar) throw notFound('Avatar not found');

    reply
      .header('content-type', avatar.mimeType)
      .header('content-length', String(avatar.size))
      .header('cache-control', 'private, max-age=31536000, immutable');

    return reply.send(avatar.stream);
  });

  app.get('/assets/:key', async (request, reply) => {
    const { key } = assetParamSchema.parse(request.params);

    const [asset] = await db
      .select({
        workspaceId: schema.assets.workspaceId,
        mimeType: schema.assets.mimeType,
        storageKey: schema.assets.storageKey,
      })
      .from(schema.assets)
      .where(eq(schema.assets.storageKey, key))
      .limit(1);

    if (!asset) throw notFound('Image not found');

    const extension = ALLOWED_MIME_TYPES.get(asset.mimeType) ?? extname(asset.storageKey);
    const path = join(assetsRoot, asset.workspaceId, `${asset.storageKey}${extension}`);

    const info = await stat(path).catch(() => null);
    if (!info) throw notFound('Image not found');

    reply
      .header('content-type', asset.mimeType)
      .header('content-length', String(info.size))
      .header('cache-control', 'private, max-age=31536000, immutable');

    return reply.send(createReadStream(path));
  });
}
