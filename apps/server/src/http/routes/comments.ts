import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, isNull, schema } from '@collaby/db';
import {
  createCommentSchema,
  updateCommentSchema,
  type CommentReply,
  type CommentThread,
  type PublicUser,
} from '@collaby/shared';
import type { AppContext } from '../../context.js';
import { requireDocumentAccess } from '../guards.js';
import { forbidden, notFound } from '../errors.js';

const documentParamSchema = z.object({ id: z.string().uuid() });
const commentParamSchema = z.object({ commentId: z.string().uuid() });

const ANONYMOUS: PublicUser = {
  id: '00000000-0000-0000-0000-000000000000',
  email: '',
  displayName: 'Removed user',
  avatarColor: '#a0aec0',
  avatarUrl: null,
};

export default async function commentRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  async function loadComment(commentId: string) {
    const [comment] = await db
      .select()
      .from(schema.comments)
      .where(and(eq(schema.comments.id, commentId), isNull(schema.comments.deletedAt)))
      .limit(1);

    if (!comment) throw notFound('Comment not found');
    return comment;
  }

  app.get('/documents/:id/comments', async (request) => {
    const { id } = documentParamSchema.parse(request.params);
    await requireDocumentAccess(context, request, id, 'document.read');

    const rows = await db
      .select({
        comment: schema.comments,
        author: {
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarColor: schema.users.avatarColor,
          avatarUrl: schema.users.avatarUrl,
        },
      })
      .from(schema.comments)
      .leftJoin(schema.users, eq(schema.users.id, schema.comments.authorId))
      .where(and(eq(schema.comments.documentId, id), isNull(schema.comments.deletedAt)))
      .orderBy(asc(schema.comments.createdAt));

    const threads = new Map<string, CommentThread>();
    const replies: { parentId: string; reply: CommentReply }[] = [];

    for (const row of rows) {
      const author = row.author ?? ANONYMOUS;

      if (row.comment.parentId) {
        replies.push({
          parentId: row.comment.parentId,
          reply: {
            id: row.comment.id,
            author,
            body: row.comment.body,
            createdAt: row.comment.createdAt.toISOString(),
            updatedAt: row.comment.updatedAt?.toISOString() ?? null,
          },
        });
        continue;
      }

      threads.set(row.comment.id, {
        id: row.comment.id,
        documentId: row.comment.documentId,
        anchorId: row.comment.anchorId,
        quotedText: row.comment.quotedText,
        resolved: row.comment.resolved,
        createdAt: row.comment.createdAt.toISOString(),
        author,
        body: row.comment.body,
        replies: [],
      });
    }

    for (const { parentId, reply } of replies) {
      threads.get(parentId)?.replies.push(reply);
    }

    return [...threads.values()];
  });

  app.post('/documents/:id/comments', async (request, reply) => {
    const { id } = documentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);
    await requireDocumentAccess(context, request, id, 'document.comment');

    const input = createCommentSchema.parse(request.body);

    if (input.parentId) {
      const parent = await loadComment(input.parentId);
      if (parent.documentId !== id) throw notFound('Parent comment not found');
    }

    const [comment] = await db
      .insert(schema.comments)
      .values({
        documentId: id,
        parentId: input.parentId ?? null,
        anchorId: input.anchorId,
        quotedText: input.quotedText ?? null,
        body: input.body,
        authorId: auth.userId,
      })
      .returning();

    if (!comment) throw new Error('Failed to create comment');

    reply.code(201);
    return {
      id: comment.id,
      documentId: comment.documentId,
      parentId: comment.parentId,
      anchorId: comment.anchorId,
      body: comment.body,
      quotedText: comment.quotedText,
      resolved: comment.resolved,
      createdAt: comment.createdAt.toISOString(),
    };
  });

  app.patch('/comments/:commentId', async (request) => {
    const { commentId } = commentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);

    const comment = await loadComment(commentId);
    await requireDocumentAccess(context, request, comment.documentId, 'document.comment');

    if (comment.authorId !== auth.userId) {
      throw forbidden('You can only edit your own comments');
    }

    const input = updateCommentSchema.parse(request.body);

    await db
      .update(schema.comments)
      .set({ body: input.body, updatedAt: new Date() })
      .where(eq(schema.comments.id, commentId));

    return { id: commentId, body: input.body };
  });

  app.delete('/comments/:commentId', async (request, reply) => {
    const { commentId } = commentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);

    const comment = await loadComment(commentId);
    const access = await requireDocumentAccess(
      context,
      request,
      comment.documentId,
      'document.comment',
    );

    const isAuthor = comment.authorId === auth.userId;
    const isModerator = access.role === 'admin' || access.role === 'owner';

    if (!isAuthor && !isModerator) {
      throw forbidden('You can only delete your own comments');
    }

    await db
      .update(schema.comments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.comments.id, commentId));

    reply.code(204);
    return null;
  });

  app.post('/comments/:commentId/resolve', async (request) => {
    const { commentId } = commentParamSchema.parse(request.params);
    const auth = app.requireAuth(request);

    const comment = await loadComment(commentId);
    await requireDocumentAccess(context, request, comment.documentId, 'document.comment');

    const { resolved } = z.object({ resolved: z.boolean() }).parse(request.body);

    await db
      .update(schema.comments)
      .set({ resolved, resolvedById: resolved ? auth.userId : null })
      .where(eq(schema.comments.id, commentId));

    return { id: commentId, resolved };
  });
}
