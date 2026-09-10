import type { AccessRole, Capability } from './roles.js';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
  avatarUrl: string | null;
}

export interface SessionDevice {
  id: string;
  deviceName: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export interface PasskeySummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
  sessionId: string;
}

export interface TwoFactorRequired {
  status: 'two_factor_required';
  challengeToken: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: 'personal' | 'group';
  slug: string;
  role: AccessRole;
  memberCount: number;
  createdAt: string;
}

export interface DocumentNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  slug: string;
  icon: string | null;
  position: number;
  isFolder: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface DocumentAccess {
  role: AccessRole;
  capabilities: Capability[];
  source: 'owner' | 'workspace' | 'document' | 'link';
}

export interface DocumentDetail extends DocumentNode {
  access: DocumentAccess;
  workspaceName: string;
}

export interface CommentThread {
  id: string;
  documentId: string;
  anchorId: string;
  quotedText: string | null;
  resolved: boolean;
  createdAt: string;
  author: PublicUser;
  body: string;
  replies: CommentReply[];
}

export interface CommentReply {
  id: string;
  author: PublicUser;
  body: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface RevisionSummary {
  oid: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
}

export interface ShareLink {
  id: string;
  token: string;
  role: AccessRole;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface PresenceUser {
  clientId: number;
  userId: string;
  displayName: string;
  avatarColor: string;
  avatarUrl: string | null;
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  icon: string | null;
  workspaceId: string;
  workspaceName: string;
  updatedAt: string;
  snippet: SnippetPart[];
  rank: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
