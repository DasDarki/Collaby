import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, schema, sql } from '@collaby/db';
import {
  capabilitiesFor,
  createDocumentSchema,
  grantDocumentAccessSchema,
  moveDocumentSchema,
  renameDocumentSchema,
  type DocumentDetail,
  type RevisionSummary,
} from '@collaby/shared';
import type { AppContext } from '../../context.js';
import { documentRepositoryPath, uniqueDocumentSlug } from '../../services/document-path.js';
import {
  descendantIds,
  isDescendantOf,
  reorderDocument,
  restoreDeleted,
} from '../../services/document-tree.js';
import { encodeState, markdownToYDoc } from '../../collab/document-store.js';
import { findUserByEmail } from '../../services/users.js';
import { searchDocuments } from '../../services/search.js';
import { requireDocumentAccess, requireWorkspaceAccess } from '../guards.js';
import { badRequest, notFound } from '../errors.js';

const documentParamSchema = z.object({ id: z.string().uuid() });
const revisionParamSchema = z.object({
  id: z.string().uuid(),
  oid: z.string().regex(/^[0-9a-f]{7,40}$/),
});

export default async function documentRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db, repository } = context;

  app.post('/', async (request, reply) => {
    const auth = app.requireAuth(request);
    const input = createDocumentSchema.parse(request.body);

    await requireWorkspaceAccess(context, request, input.workspaceId, 'workspace.createDocument');

    if (input.parentId) {
      const parent = await db
        .select({ workspaceId: schema.documents.workspaceId })
        .from(schema.documents)
        .where(eq(schema.documents.id, input.parentId))
        .limit(1);

      if (parent[0]?.workspaceId !== input.workspaceId) {
        throw badRequest('The parent document belongs to a different workspace');
      }
    }

    const slug = await uniqueDocumentSlug(db, input.workspaceId, input.title);

    const [position] = await db
      .select({ next: sql<number>`COALESCE(MAX(${schema.documents.position}), -1) + 1` })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.workspaceId, input.workspaceId),
          input.parentId
            ? eq(schema.documents.parentId, input.parentId)
            : isNull(schema.documents.parentId),
        ),
      );

    const [document] = await db
      .insert(schema.documents)
      .values({
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        title: input.title,
        slug,
        position: position?.next ?? 0,
        isFolder: input.isFolder,
        createdById: auth.userId,
      })
      .returning();

    if (!document) throw new Error('Failed to create document');

    if (!input.isFolder) {
      const seeded = markdownToYDoc(`# ${input.title}\n\n`);
      await db.insert(schema.documentStates).values({
        documentId: document.id,
        state: encodeState(seeded),
        markdown: `# ${input.title}\n`,
      });
      seeded.destroy();
    }

    reply.code(201);
    return {
      ...document,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      deletedAt: null,
    };
  });

  app.get('/:id', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    const access = await requireDocumentAccess(context, request, id, 'document.read');

    const [workspace] = await db
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, access.document.workspaceId))
      .limit(1);

    return {
      ...access.document,
      createdAt: access.document.createdAt.toISOString(),
      updatedAt: access.document.updatedAt.toISOString(),
      workspaceName: workspace?.name ?? 'Workspace',
      access: {
        role: access.role,
        source: access.source,
        capabilities: capabilitiesFor(access.role),
      },
    } satisfies DocumentDetail;
  });

  app.get('/:id/markdown', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    await requireDocumentAccess(context, request, id, 'document.read');

    const [state] = await db
      .select({ markdown: schema.documentStates.markdown })
      .from(schema.documentStates)
      .where(eq(schema.documentStates.documentId, id))
      .limit(1);

    return { markdown: state?.markdown ?? '' };
  });

  app.patch('/:id', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    const access = await requireDocumentAccess(context, request, id, 'document.rename');

    const body = renameDocumentSchema.extend({ icon: z.string().max(16).nullable().optional() });
    const input = body.parse(request.body);

    const previousPath = await documentRepositoryPath(db, id);
    const slug = await uniqueDocumentSlug(db, access.document.workspaceId, input.title);

    await db
      .update(schema.documents)
      .set({
        title: input.title,
        slug: slug === access.document.slug ? access.document.slug : slug,
        icon: input.icon ?? access.document.icon,
        updatedAt: new Date(),
      })
      .where(eq(schema.documents.id, id));

    const nextPath = await documentRepositoryPath(db, id);

    if (nextPath !== previousPath) {
      const [state] = await db
        .select({ markdown: schema.documentStates.markdown })
        .from(schema.documentStates)
        .where(eq(schema.documentStates.documentId, id))
        .limit(1);

      await repository.renameFile({
        workspaceId: access.document.workspaceId,
        fromPath: previousPath,
        toPath: nextPath,
        content: state?.markdown ?? '',
        message: `Rename ${access.document.title} to ${input.title}`,
      });
    }

    return { id, title: input.title, slug };
  });

  app.post('/:id/move', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    const access = await requireDocumentAccess(context, request, id, 'document.move');
    const input = moveDocumentSchema.parse(request.body);

    if (input.parentId === id) throw badRequest('A document cannot be its own parent');

    if (input.parentId) {
      const [parent] = await db
        .select({ workspaceId: schema.documents.workspaceId })
        .from(schema.documents)
        .where(eq(schema.documents.id, input.parentId))
        .limit(1);

      if (!parent || parent.workspaceId !== access.document.workspaceId) {
        throw badRequest('The target folder belongs to a different workspace');
      }

      if (await isDescendantOf(db, input.parentId, id)) {
        throw badRequest('A document cannot be moved inside one of its own children');
      }
    }

    const previousPath = await documentRepositoryPath(db, id);

    const result = await reorderDocument(
      db,
      {
        id,
        workspaceId: access.document.workspaceId,
        parentId: access.document.parentId,
      },
      input.parentId,
      input.index,
    );

    if (access.document.parentId !== input.parentId) {
      const nextPath = await documentRepositoryPath(db, id);

      if (nextPath !== previousPath) {
        const [state] = await db
          .select({ markdown: schema.documentStates.markdown })
          .from(schema.documentStates)
          .where(eq(schema.documentStates.documentId, id))
          .limit(1);

        await repository.renameFile({
          workspaceId: access.document.workspaceId,
          fromPath: previousPath,
          toPath: nextPath,
          content: state?.markdown ?? '',
          message: `Move ${access.document.title}`,
        });
      }
    }

    return { id, parentId: result.parentId, index: result.index };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = documentParamSchema.parse(request.params);
    const access = await requireDocumentAccess(context, request, id, 'document.delete');

    const affected = await descendantIds(db, id);
    const paths = new Map<string, string>();

    for (const documentId of affected) {
      paths.set(documentId, await documentRepositoryPath(db, documentId));
    }

    const batchId = randomUUID();

    await db
      .update(schema.documents)
      .set({ deletedAt: new Date(), deletedBatchId: batchId })
      .where(inArray(schema.documents.id, affected));

    const removable = await db
      .select({ id: schema.documents.id, isFolder: schema.documents.isFolder })
      .from(schema.documents)
      .where(inArray(schema.documents.id, affected));

    for (const document of removable) {
      if (document.isFolder) continue;

      const filepath = paths.get(document.id);
      if (!filepath) continue;

      await repository.removeFile({
        workspaceId: access.document.workspaceId,
        filepath,
        message: `Delete ${access.document.title}`,
      });
    }

    reply.code(204);
    return { deleted: affected.length };
  });

  app.post('/:id/restore', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);

    const [target] = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        workspaceId: schema.documents.workspaceId,
        deletedBatchId: schema.documents.deletedBatchId,
      })
      .from(schema.documents)
      .where(and(eq(schema.documents.id, id), isNotNull(schema.documents.deletedAt)))
      .limit(1);

    if (!target) throw notFound('That page is not in the trash');

    await requireWorkspaceAccess(context, request, target.workspaceId, 'document.delete');

    const restored = await restoreDeleted(db, target.id, target.deletedBatchId);
    if (restored.length === 0) throw notFound('That page is not in the trash');

    for (const document of restored) {
      if (document.isFolder) continue;

      const [state] = await db
        .select({ markdown: schema.documentStates.markdown })
        .from(schema.documentStates)
        .where(eq(schema.documentStates.documentId, document.id))
        .limit(1);

      await repository.commitFile({
        workspaceId: target.workspaceId,
        filepath: await documentRepositoryPath(db, document.id),
        content: state?.markdown ?? '',
        message: `Restore ${document.title}`,
      });
    }

    void auth;
    return { restored: restored.length, documentId: target.id };
  });

  app.get('/:id/revisions', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    const access = await requireDocumentAccess(context, request, id, 'document.history.read');

    const filepath = await documentRepositoryPath(db, id);
    const revisions = await repository.listRevisions(access.document.workspaceId, filepath);

    return revisions satisfies RevisionSummary[];
  });

  app.get('/:id/revisions/:oid', async (request) => {
    const { id, oid } = revisionParamSchema.parse(request.params);
    const access = await requireDocumentAccess(context, request, id, 'document.history.read');

    const filepath = await documentRepositoryPath(db, id);
    const markdown = await repository.readRevision(access.document.workspaceId, filepath, oid);

    if (markdown === null) throw notFound('Revision not found');
    return { oid, markdown };
  });

  app.post('/:id/revisions/:oid/restore', async (request) => {
    const { id, oid } = revisionParamSchema.parse(request.params);
    const access = await requireDocumentAccess(context, request, id, 'document.history.restore');

    const filepath = await documentRepositoryPath(db, id);
    const markdown = await repository.readRevision(access.document.workspaceId, filepath, oid);
    if (markdown === null) throw notFound('Revision not found');

    const restored = markdownToYDoc(markdown);
    const state = encodeState(restored);
    restored.destroy();

    await db
      .update(schema.documentStates)
      .set({ state, markdown, updatedAt: new Date() })
      .where(eq(schema.documentStates.documentId, id));

    return { id, oid, restored: true };
  });

  app.get('/:id/permissions', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    await requireDocumentAccess(context, request, id, 'document.share');

    const rows = await db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        avatarColor: schema.users.avatarColor,
        avatarUrl: schema.users.avatarUrl,
        role: schema.documentPermissions.role,
        createdAt: schema.documentPermissions.createdAt,
      })
      .from(schema.documentPermissions)
      .innerJoin(schema.users, eq(schema.users.id, schema.documentPermissions.userId))
      .where(eq(schema.documentPermissions.documentId, id))
      .orderBy(asc(schema.documentPermissions.createdAt));

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  });

  app.post('/:id/permissions', async (request, reply) => {
    const { id } = documentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);
    await requireDocumentAccess(context, request, id, 'document.share');

    const input = grantDocumentAccessSchema.parse(request.body);
    const user = await findUserByEmail(db, input.email);
    if (!user) throw notFound('No account exists for this email address yet');

    await db
      .insert(schema.documentPermissions)
      .values({
        documentId: id,
        userId: user.id,
        role: input.role,
        grantedById: auth.userId,
      })
      .onConflictDoUpdate({
        target: [schema.documentPermissions.documentId, schema.documentPermissions.userId],
        set: { role: input.role, grantedById: auth.userId },
      });

    reply.code(201);
    return { userId: user.id, role: input.role };
  });

  app.delete('/:id/permissions/:userId', async (request, reply) => {
    const { id, userId } = z
      .object({ id: z.string().uuid(), userId: z.string().uuid() })
      .parse(request.params);

    await requireDocumentAccess(context, request, id, 'document.share');

    await db
      .delete(schema.documentPermissions)
      .where(
        and(
          eq(schema.documentPermissions.documentId, id),
          eq(schema.documentPermissions.userId, userId),
        ),
      );

    reply.code(204);
    return null;
  });

  app.get('/search', async (request) => {
    const auth = app.requireAuth(request);
    const { q, workspaceId } = z
      .object({ q: z.string().trim().max(200).default(''), workspaceId: z.string().uuid() })
      .parse(request.query);

    await requireWorkspaceAccess(context, request, workspaceId, 'workspace.read');

    if (q.length === 0) {
      const recent = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          slug: schema.documents.slug,
          icon: schema.documents.icon,
          updatedAt: schema.documents.updatedAt,
        })
        .from(schema.documents)
        .where(
          and(eq(schema.documents.workspaceId, workspaceId), isNull(schema.documents.deletedAt)),
        )
        .orderBy(desc(schema.documents.updatedAt))
        .limit(20);

      return recent.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
    }

    const hits = await searchDocuments(db, auth.userId, q, { workspaceId, limit: 20 });

    return hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      icon: hit.icon,
      updatedAt: hit.updatedAt,
    }));
  });
}
