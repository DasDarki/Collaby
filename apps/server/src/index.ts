import { pino } from 'pino';
import { loadEnv } from './config/env.js';
import { createAppContext } from './context.js';
import { buildServer } from './http/server.js';
import { applyMigrations } from './migrations.js';

const env = loadEnv();

const logger = pino({
  level: env.isProduction ? 'info' : 'debug',
  transport: env.isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

const context = createAppContext(env, logger);

if (env.RUN_MIGRATIONS) {
  try {
    const folder = await applyMigrations(context.db, env.MIGRATIONS_DIR);
    logger.info({ folder }, 'Database migrations applied');
  } catch (error) {
    logger.error({ err: error }, 'Database migrations failed');
    process.exit(1);
  }
}

const server = await buildServer(context);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  try {
    await server.close();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await server.app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ port: env.PORT }, 'Collaby API is listening');
} catch (error) {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
}
