import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { AppContext } from '../context.js';
import { createCollabServer } from '../collab/server.js';
import authenticatePlugin from './plugins/authenticate.js';
import { HttpError } from './errors.js';
import accountRoutes from './routes/account.js';
import assetRoutes from './routes/assets.js';
import authRoutes from './routes/auth.js';
import commentRoutes from './routes/comments.js';
import documentRoutes from './routes/documents.js';
import searchRoutes from './routes/search.js';
import shareRoutes from './routes/shares.js';
import workspaceRoutes from './routes/workspaces.js';

export interface CollabyServer {
  app: FastifyInstance;
  close: () => Promise<void>;
}

export async function buildServer(context: AppContext): Promise<CollabyServer> {
  const app = Fastify({
    loggerInstance: context.logger,
    trustProxy: true,
    bodyLimit: context.env.MAX_UPLOAD_BYTES,
  });

  await app.register(cors, {
    origin: context.env.webauthnOrigins,
    credentials: true,
    exposedHeaders: ['x-collaby-share-grant'],
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(multipart, {
    limits: { fileSize: context.env.MAX_UPLOAD_BYTES, files: 1 },
  });

  await app.register(websocket, {
    options: { maxPayload: 16 * 1024 * 1024 },
  });

  await app.register(authenticatePlugin, context);

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_failed',
        message: 'The request payload is not valid',
        details: error.issues,
      });
    }

    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code, message: error.message, details: error.details });
    }

    const fastifyError = error as FastifyError;
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply
        .code(fastifyError.statusCode)
        .send({ error: fastifyError.code ?? 'request_failed', message: error.message });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply
      .code(500)
      .send({ error: 'internal_error', message: 'Something went wrong on our side' });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'collaby' }));

  await app.register(async (instance) => authRoutes(instance, context), { prefix: '/api/auth' });
  await app.register(async (instance) => accountRoutes(instance, context), {
    prefix: '/api/account',
  });
  await app.register(async (instance) => workspaceRoutes(instance, context), {
    prefix: '/api/workspaces',
  });
  await app.register(async (instance) => documentRoutes(instance, context), {
    prefix: '/api/documents',
  });
  await app.register(async (instance) => commentRoutes(instance, context), { prefix: '/api' });
  await app.register(async (instance) => shareRoutes(instance, context), { prefix: '/api' });
  await app.register(async (instance) => assetRoutes(instance, context), { prefix: '/api' });
  await app.register(async (instance) => searchRoutes(instance, context), { prefix: '/api' });

  const collab = createCollabServer(context);

  app.get('/collab', { websocket: true }, (socket, request) => {
    collab.handleConnection(socket, request.raw);
  });

  return {
    app,
    async close() {
      await collab.destroy();
      await app.close();
      await context.closeDatabase();
    },
  };
}
