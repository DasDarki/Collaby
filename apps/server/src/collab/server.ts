import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import { eq, schema } from '@collaby/db';
import { can, type AccessRole } from '@collaby/shared';
import { Hocuspocus } from '@hocuspocus/server';
import type { AppContext } from '../context.js';
import { isSessionActive, touchSession } from '../auth/sessions.js';
import { resolveDocumentAccess, type ShareLinkGrant } from '../access/resolve.js';
import { findActiveShareLink } from '../services/share-links.js';
import { documentRepositoryPath } from '../services/document-path.js';
import { applyState, encodeState, markdownToYDoc, yDocToMarkdown } from './document-store.js';

export interface CollabConnectionContext {
  userId: string | null;
  role: AccessRole;
  displayName: string;
  avatarColor: string;
}

export interface CollabServer {
  handleConnection: (socket: WebSocket, request: IncomingMessage) => void;
  destroy: () => Promise<void>;
}

export function createCollabServer(context: AppContext): CollabServer {
  const { db, env, accessTokens, repository, logger } = context;
  const pendingCommits = new Map<string, NodeJS.Timeout>();

  async function resolveShareGrant(token: string | null): Promise<ShareLinkGrant | null> {
    if (!token) return null;
    const link = await findActiveShareLink(db, token);
    if (!link || link.passwordHash) return null;
    return { role: link.role, documentId: link.documentId, workspaceId: link.workspaceId };
  }

  async function scheduleCommit(documentId: string, markdown: string): Promise<void> {
    const existing = pendingCommits.get(documentId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      pendingCommits.delete(documentId);
      void commitDocument(documentId, markdown);
    }, env.GIT_COMMIT_DEBOUNCE_MS);

    timer.unref();
    pendingCommits.set(documentId, timer);
  }

  async function commitDocument(documentId: string, markdown: string): Promise<void> {
    try {
      const [document] = await db
        .select({
          workspaceId: schema.documents.workspaceId,
          title: schema.documents.title,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1);

      if (!document) return;

      const filepath = await documentRepositoryPath(db, documentId);
      const oid = await repository.commitFile({
        workspaceId: document.workspaceId,
        filepath,
        content: markdown,
        message: `Update ${document.title}`,
      });

      if (!oid) return;

      await db.insert(schema.documentRevisions).values({
        documentId,
        commitOid: oid,
        message: `Update ${document.title}`,
      });

      await db
        .update(schema.documentStates)
        .set({ committedAt: new Date() })
        .where(eq(schema.documentStates.documentId, documentId));
    } catch (error) {
      logger.error({ err: error, documentId }, 'Failed to commit document revision');
    }
  }

  const hocuspocus = new Hocuspocus({
    name: 'collaby',
    debounce: 2_000,
    maxDebounce: 10_000,
    quiet: true,

    async onAuthenticate(data) {
      const shareToken = data.requestParameters.get('shareToken');
      const accessToken = data.token || data.requestParameters.get('token');

      let userId: string | null = null;
      let displayName = 'Guest';
      let avatarColor = '#7c9cff';

      if (accessToken) {
        const claims = await accessTokens.verify(accessToken);
        if (claims && (await isSessionActive(db, claims.sessionId))) {
          userId = claims.userId;
          void touchSession(db, claims.sessionId);

          const [user] = await db
            .select({
              displayName: schema.users.displayName,
              avatarColor: schema.users.avatarColor,
            })
            .from(schema.users)
            .where(eq(schema.users.id, claims.userId))
            .limit(1);

          if (user) {
            displayName = user.displayName;
            avatarColor = user.avatarColor;
          }
        }
      }

      const grant = await resolveShareGrant(shareToken);
      const access = await resolveDocumentAccess(db, userId, data.documentName, grant);

      if (!access) {
        throw new Error('Not authorized to open this document');
      }

      if (!can(access.role, 'document.edit')) {
        data.connectionConfig.readOnly = true;
      }

      return {
        userId,
        role: access.role,
        displayName,
        avatarColor,
      } satisfies CollabConnectionContext;
    },

    async onLoadDocument(data) {
      const [stored] = await db
        .select({ state: schema.documentStates.state, markdown: schema.documentStates.markdown })
        .from(schema.documentStates)
        .where(eq(schema.documentStates.documentId, data.documentName))
        .limit(1);

      if (stored?.state && stored.state.byteLength > 0) {
        applyState(data.document, stored.state);
        return data.document;
      }

      if (stored?.markdown) {
        const seeded = markdownToYDoc(stored.markdown);
        applyState(data.document, encodeState(seeded));
        seeded.destroy();
      }

      return data.document;
    },

    async onStoreDocument(data) {
      const state = encodeState(data.document as unknown as Y.Doc);
      let markdown = '';

      try {
        markdown = yDocToMarkdown(data.document as unknown as Y.Doc);
      } catch (error) {
        logger.warn({ err: error, documentId: data.documentName }, 'Markdown export failed');
      }

      await db
        .insert(schema.documentStates)
        .values({
          documentId: data.documentName,
          state,
          markdown,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.documentStates.documentId,
          set: { state, markdown, updatedAt: new Date() },
        });

      await db
        .update(schema.documents)
        .set({ updatedAt: new Date() })
        .where(eq(schema.documents.id, data.documentName));

      if (markdown) {
        await scheduleCommit(data.documentName, markdown);
      }
    },
  });

  return {
    handleConnection(socket, request) {
      hocuspocus.handleConnection(socket, request);
    },
    async destroy() {
      for (const timer of pendingCommits.values()) clearTimeout(timer);
      pendingCommits.clear();
      hocuspocus.closeConnections();
    },
  };
}
