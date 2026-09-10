import { z } from 'zod';
import { ACCESS_ROLES } from './roles.js';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters long')
  .max(200);

export const displayNameSchema = z.string().trim().min(1).max(80);

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Authenticator code must be 6 digits');

export const recoveryCodeSchema = z.string().trim().min(8).max(40);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const twoFactorChallengeSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.union([totpCodeSchema, recoveryCodeSchema]),
});

export const deviceInfoSchema = z.object({
  deviceName: z.string().trim().max(120).optional(),
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

export const passkeyRegistrationFinishSchema = z.object({
  label: z.string().trim().min(1).max(80),
  response: z.record(z.unknown()),
});

export const passkeyAuthenticationFinishSchema = z.object({
  challengeId: z.string().min(1),
  response: z.record(z.unknown()),
});

export const workspaceKindSchema = z.enum(['personal', 'group']);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: workspaceKindSchema.default('group'),
});

export const accessRoleSchema = z.enum(ACCESS_ROLES);

export const shareableRoleSchema = z.enum(['viewer', 'commenter', 'editor']);

export const workspaceMemberRoleSchema = z.enum(['viewer', 'commenter', 'editor', 'admin']);

export const createDocumentSchema = z.object({
  workspaceId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).default('Untitled'),
  isFolder: z.boolean().default(false),
});

export const renameDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const moveDocumentSchema = z.object({
  parentId: z.string().uuid().nullable(),
  index: z.number().int().min(0).optional(),
});

export const createShareLinkSchema = z.object({
  role: shareableRoleSchema,
  expiresAt: z.coerce.date().nullable().optional(),
  password: z.string().min(4).max(200).nullable().optional(),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: workspaceMemberRoleSchema,
});

export const grantDocumentAccessSchema = z.object({
  email: emailSchema,
  role: shareableRoleSchema,
});

export const createCommentSchema = z.object({
  anchorId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(10_000),
  quotedText: z.string().max(1000).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
