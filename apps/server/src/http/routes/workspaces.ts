import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, isNull, schema } from '@collaby/db';
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  workspaceMemberRoleSchema,
  type DocumentNode,
} from '@collaby/shared';
import type { AppContext } from '../../context.js';
import { createWorkspace, listWorkspacesForUser } from '../../services/workspaces.js';
import { findUserByEmail } from '../../services/users.js';
import { requireWorkspaceAccess } from '../guards.js';
import { badRequest, conflict, notFound } from '../errors.js';

const workspaceParamSchema = z.object({ id: z.string().uuid() });
const memberParamSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

export default async function workspaceRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  app.get('/', async (request) => {
    const auth = app.requireAuth(request);
    return listWorkspacesForUser(db, auth.userId);
  });

  app.post('/', async (request, reply) => {
    const auth = app.requireAuth(request);
    const input = createWorkspaceSchema.parse(request.body);

    if (input.kind === 'personal') {
      const existing = await db
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(
          and(eq(schema.workspaces.ownerId, auth.userId), eq(schema.workspaces.kind, 'personal')),
        )
        .limit(1);

      if (existing.length > 0) throw conflict('You already have a personal workspace');
    }

    const workspace = await createWorkspace(db, auth.userId, input.name, input.kind);
    await context.repository.ensureRepository(workspace.id);

    reply.code(201);
    return workspace;
  });

  app.get('/:id', async (request) => {
    const { id } = workspaceParamSchema.parse(request.params);
    const access = await requireWorkspaceAccess(context, request, id, 'workspace.read');

    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    if (!workspace) throw notFound('Workspace not found');

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      kind: workspace.kind,
      createdAt: workspace.createdAt.toISOString(),
      role: access.role,
    };
  });

  app.patch('/:id', async (request) => {
    const { id } = workspaceParamSchema.parse(request.params);
    await requireWorkspaceAccess(context, request, id, 'workspace.rename');

    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);

    await db
      .update(schema.workspaces)
      .set({ name, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, id));

    return { id, name };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = workspaceParamSchema.parse(request.params);
    await requireWorkspaceAccess(context, request, id, 'workspace.delete');

    const [workspace] = await db
      .select({ kind: schema.workspaces.kind })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    if (!workspace) throw notFound('Workspace not found');
    if (workspace.kind === 'personal') {
      throw badRequest('Personal workspaces cannot be deleted');
    }

    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));

    reply.code(204);
    return null;
  });

  app.get('/:id/members', async (request) => {
    const { id } = workspaceParamSchema.parse(request.params);
    await requireWorkspaceAccess(context, request, id, 'workspace.read');

    const rows = await db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        avatarColor: schema.users.avatarColor,
        avatarUrl: schema.users.avatarUrl,
        role: schema.workspaceMembers.role,
        joinedAt: schema.workspaceMembers.createdAt,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
      .where(eq(schema.workspaceMembers.workspaceId, id))
      .orderBy(asc(schema.workspaceMembers.createdAt));

    return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
  });

  app.post('/:id/members', async (request, reply) => {
    const { id } = workspaceParamSchema.parse(request.params);
    const auth = app.requireAuth(request);
    await requireWorkspaceAccess(context, request, id, 'workspace.invite');

    const input = inviteMemberSchema.parse(request.body);
    const user = await findUserByEmail(db, input.email);

    if (!user) {
      throw notFound('No account exists for this email address yet');
    }

    const existing = await db
      .select({ userId: schema.workspaceMembers.userId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, id),
          eq(schema.workspaceMembers.userId, user.id),
        ),
      )
      .limit(1);

    if (existing.length > 0) throw conflict('This person is already a member');

    await db.insert(schema.workspaceMembers).values({
      workspaceId: id,
      userId: user.id,
      role: input.role,
      invitedById: auth.userId,
    });

    reply.code(201);
    return { userId: user.id, role: input.role };
  });

  app.patch('/:id/members/:userId', async (request) => {
    const { id, userId } = memberParamSchema.parse(request.params);
    await requireWorkspaceAccess(context, request, id, 'workspace.manageMembers');

    const { role } = z.object({ role: workspaceMemberRoleSchema }).parse(request.body);

    const [workspace] = await db
      .select({ ownerId: schema.workspaces.ownerId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    if (workspace?.ownerId === userId) throw badRequest('The workspace owner cannot be changed');

    const updated = await db
      .update(schema.workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, id),
          eq(schema.workspaceMembers.userId, userId),
        ),
      )
      .returning({ userId: schema.workspaceMembers.userId });

    if (updated.length === 0) throw notFound('Member not found');
    return { userId, role };
  });

  app.delete('/:id/members/:userId', async (request, reply) => {
    const { id, userId } = memberParamSchema.parse(request.params);
    await requireWorkspaceAccess(context, request, id, 'workspace.manageMembers');

    const [workspace] = await db
      .select({ ownerId: schema.workspaces.ownerId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    if (workspace?.ownerId === userId) throw badRequest('The workspace owner cannot be removed');

    await db
      .delete(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, id),
          eq(schema.workspaceMembers.userId, userId),
        ),
      );

    reply.code(204);
    return null;
  });

  app.get('/:id/documents', async (request) => {
    const { id } = workspaceParamSchema.parse(request.params);
    await requireWorkspaceAccess(context, request, id, 'workspace.read');

    const rows = await db
      .select({
        id: schema.documents.id,
        workspaceId: schema.documents.workspaceId,
        parentId: schema.documents.parentId,
        title: schema.documents.title,
        slug: schema.documents.slug,
        icon: schema.documents.icon,
        position: schema.documents.position,
        isFolder: schema.documents.isFolder,
        createdAt: schema.documents.createdAt,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(and(eq(schema.documents.workspaceId, id), isNull(schema.documents.deletedAt)))
      .orderBy(asc(schema.documents.position), asc(schema.documents.createdAt));

    return rows.map((row): DocumentNode => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  });
}
