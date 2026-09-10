import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { searchDocuments } from '../../services/search.js';

const searchQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export default async function searchRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  app.get(
    '/search',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const auth = app.requireAuth(request);
      const { q, workspaceId, limit } = searchQuerySchema.parse(request.query);

      if (q.length === 0) return [];

      return searchDocuments(context.db, auth.userId, q, { workspaceId, limit });
    },
  );
}
