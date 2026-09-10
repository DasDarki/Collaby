import type { FastifyBaseLogger } from 'fastify';
import { createDatabase, type Database } from '@collaby/db';
import type { Env } from './config/env.js';
import { createAccessTokenIssuer, type AccessTokenIssuer } from './auth/tokens.js';
import { WorkspaceRepository } from './vcs/repository.js';

export interface AppContext {
  env: Env;
  db: Database;
  closeDatabase: () => Promise<void>;
  accessTokens: AccessTokenIssuer;
  repository: WorkspaceRepository;
  logger: FastifyBaseLogger;
}

export function createAppContext(env: Env, logger: FastifyBaseLogger): AppContext {
  const { db, client } = createDatabase(env.DATABASE_URL);

  return {
    env,
    db,
    closeDatabase: () => client.end(),
    accessTokens: createAccessTokenIssuer(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS),
    repository: new WorkspaceRepository({
      dataDir: env.DATA_DIR,
      defaultAuthor: { name: env.GIT_AUTHOR_NAME, email: env.GIT_AUTHOR_EMAIL },
    }),
    logger,
  };
}
