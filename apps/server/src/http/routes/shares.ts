import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, isNull, schema } from '@collaby/db';
import { createShareLinkSchema, type ShareLink } from '@collaby/shared';
import type { AppContext } from '../../context.js';
import { randomToken } from '../../auth/crypto.js';
import { hashPassword } from '../../auth/password.js';
import { findActiveShareLink, unlockShareLink } from '../../services/share-links.js';
import { signShareGrant } from '../../services/share-grants.js';
import { requireDocumentAccess, requireWorkspaceAccess } from '../guards.js';
import { notFound, unauthorized } from '../errors.js';

const documentParamSchema = z.object({ id: z.string().uuid() });
const workspaceParamSchema = z.object({ id: z.string().uuid() });
const linkParamSchema = z.object({ linkId: z.string().uuid() });
const tokenParamSchema = z.object({ token: z.string().min(10).max(200) });

function toShareLink(row: {
  id: string;
  token: string;
  role: ShareLink['role'];
  passwordHash: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): ShareLink {
  return {
    id: row.id,
    token: row.token,
    role: row.role,
    hasPassword: Boolean(row.passwordHash),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export default async function shareRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  app.get('/documents/:id/share-links', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    await requireDocumentAccess(context, request, id, 'document.share');

    const rows = await db
      .select()
      .from(schema.shareLinks)
      .where(and(eq(schema.shareLinks.documentId, id), isNull(schema.shareLinks.revokedAt)))
      .orderBy(asc(schema.shareLinks.createdAt));

    return rows.map(toShareLink);
  });

  app.post('/documents/:id/share-links', async (request, reply) => {
    const { id } = documentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);
    await requireDocumentAccess(context, request, id, 'document.share');

    const input = createShareLinkSchema.parse(request.body);

    const [created] = await db
      .insert(schema.shareLinks)
      .values({
        token: randomToken(24),
        documentId: id,
        role: input.role,
        passwordHash: input.password ? await hashPassword(input.password) : null,
        expiresAt: input.expiresAt ?? null,
        createdById: auth.userId,
      })
      .returning();

    if (!created) throw new Error('Failed to create share link');

    reply.code(201);
    return toShareLink(created);
  });

  app.post('/workspaces/:id/share-links', async (request, reply) => {
    const { id } = workspaceParamSchema.parse(request.params);
    const auth = app.requireAuth(request);
    await requireWorkspaceAccess(context, request, id, 'workspace.invite');

    const input = createShareLinkSchema.parse(request.body);

    const [created] = await db
      .insert(schema.shareLinks)
      .values({
        token: randomToken(24),
        workspaceId: id,
        role: input.role,
        passwordHash: input.password ? await hashPassword(input.password) : null,
        expiresAt: input.expiresAt ?? null,
        createdById: auth.userId,
      })
      .returning();

    if (!created) throw new Error('Failed to create share link');

    reply.code(201);
    return toShareLink(created);
  });

  app.get('/workspaces/:id/share-links', async (request) => {
    const { id } = workspaceParamSchema.parse(request.params);
    await requireWorkspaceAccess(context, request, id, 'workspace.invite');

    const rows = await db
      .select()
      .from(schema.shareLinks)
      .where(and(eq(schema.shareLinks.workspaceId, id), isNull(schema.shareLinks.revokedAt)))
      .orderBy(asc(schema.shareLinks.createdAt));

    return rows.map(toShareLink);
  });

  app.delete('/share-links/:linkId', async (request, reply) => {
    const { linkId } = linkParamSchema.parse(request.params);

    const [link] = await db
      .select()
      .from(schema.shareLinks)
      .where(eq(schema.shareLinks.id, linkId))
      .limit(1);

    if (!link) throw notFound('Share link not found');

    if (link.documentId) {
      await requireDocumentAccess(context, request, link.documentId, 'document.share');
    } else if (link.workspaceId) {
      await requireWorkspaceAccess(context, request, link.workspaceId, 'workspace.invite');
    }

    await db
      .update(schema.shareLinks)
      .set({ revokedAt: new Date() })
      .where(eq(schema.shareLinks.id, linkId));

    reply.code(204);
    return null;
  });

  app.get('/share/:token', async (request) => {
    const { token } = tokenParamSchema.parse(request.params);
    const link = await findActiveShareLink(db, token);
    if (!link) throw notFound('This link is no longer available');

    return {
      role: link.role,
      documentId: link.documentId,
      workspaceId: link.workspaceId,
      requiresPassword: Boolean(link.passwordHash),
    };
  });

  app.post(
    '/share/:token/unlock',
    { config: { rateLimit: { max: 15, timeWindow: '5 minutes' } } },
    async (request) => {
      const { token } = tokenParamSchema.parse(request.params);
      const { password } = z
        .object({ password: z.string().max(200).nullable().default(null) })
        .parse(request.body ?? {});

      const link = await findActiveShareLink(db, token);
      if (!link) throw notFound('This link is no longer available');

      if (!(await unlockShareLink(link, password))) {
        throw unauthorized('That password is not correct');
      }

      const grant = await signShareGrant(context.env.JWT_SECRET, {
        shareLinkId: link.id,
        role: link.role,
        documentId: link.documentId,
        workspaceId: link.workspaceId,
      });

      return {
        grantToken: grant.token,
        expiresAt: grant.expiresAt.toISOString(),
        role: link.role,
        documentId: link.documentId,
        workspaceId: link.workspaceId,
      };
    },
  );
}
