import type { FastifyRequest } from 'fastify';
import { can, type Capability } from '@collaby/shared';
import type { AppContext } from '../context.js';
import {
  resolveDocumentAccess,
  resolveWorkspaceAccess,
  type DocumentAccessResult,
  type ResolvedAccess,
  type ShareLinkGrant,
} from '../access/resolve.js';
import { verifyShareGrant } from '../services/share-grants.js';
import { findActiveShareLink } from '../services/share-links.js';
import { forbidden, notFound, unauthorized } from './errors.js';

export async function shareGrantFromRequest(
  context: AppContext,
  request: FastifyRequest,
): Promise<ShareLinkGrant | null> {
  const query = request.query as { shareToken?: string; shareGrant?: string };
  const headerGrant = request.headers['x-collaby-share-grant'];
  const grantToken = query.shareGrant ?? (typeof headerGrant === 'string' ? headerGrant : null);

  if (grantToken) {
    const grant = await verifyShareGrant(context.env.JWT_SECRET, grantToken);
    if (grant) {
      return {
        role: grant.role,
        documentId: grant.documentId,
        workspaceId: grant.workspaceId,
      };
    }
  }

  const headerToken = request.headers['x-collaby-share-token'];
  const shareToken = query.shareToken ?? (typeof headerToken === 'string' ? headerToken : null);

  if (shareToken) {
    const link = await findActiveShareLink(context.db, shareToken);
    if (link && !link.passwordHash) {
      return { role: link.role, documentId: link.documentId, workspaceId: link.workspaceId };
    }
  }

  return null;
}

export async function requireDocumentAccess(
  context: AppContext,
  request: FastifyRequest,
  documentId: string,
  capability: Capability,
): Promise<DocumentAccessResult> {
  const grant = await shareGrantFromRequest(context, request);
  const userId = request.auth?.userId ?? null;

  if (!userId && !grant) throw unauthorized();

  const access = await resolveDocumentAccess(context.db, userId, documentId, grant);
  if (!access) throw notFound('Document not found');

  if (!can(access.role, capability)) {
    throw forbidden('Your role does not allow this action');
  }

  return access;
}

export async function requireWorkspaceAccess(
  context: AppContext,
  request: FastifyRequest,
  workspaceId: string,
  capability: Capability,
): Promise<ResolvedAccess> {
  const userId = request.auth?.userId ?? null;
  if (!userId) throw unauthorized();

  const access = await resolveWorkspaceAccess(context.db, userId, workspaceId);
  if (!access) throw notFound('Workspace not found');

  if (!can(access.role, capability)) {
    throw forbidden('Your role does not allow this action');
  }

  return access;
}
