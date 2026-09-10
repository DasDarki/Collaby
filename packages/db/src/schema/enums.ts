import { pgEnum } from 'drizzle-orm/pg-core';

export const accessRoleEnum = pgEnum('access_role', [
  'viewer',
  'commenter',
  'editor',
  'admin',
  'owner',
]);

export const workspaceKindEnum = pgEnum('workspace_kind', ['personal', 'group']);

export const oauthProviderEnum = pgEnum('oauth_provider', ['google']);

export const webauthnChallengeKindEnum = pgEnum('webauthn_challenge_kind', [
  'registration',
  'authentication',
]);
