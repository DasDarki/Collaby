export const ACCESS_ROLES = ['viewer', 'commenter', 'editor', 'admin', 'owner'] as const;

export type AccessRole = (typeof ACCESS_ROLES)[number];

const ROLE_RANK: Record<AccessRole, number> = {
  viewer: 10,
  commenter: 20,
  editor: 30,
  admin: 40,
  owner: 50,
};

export const CAPABILITIES = [
  'document.read',
  'document.comment',
  'document.edit',
  'document.rename',
  'document.move',
  'document.delete',
  'document.share',
  'document.history.read',
  'document.history.restore',
  'workspace.read',
  'workspace.createDocument',
  'workspace.invite',
  'workspace.manageMembers',
  'workspace.rename',
  'workspace.delete',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MINIMUM_ROLE_FOR_CAPABILITY: Record<Capability, AccessRole> = {
  'document.read': 'viewer',
  'document.comment': 'commenter',
  'document.edit': 'editor',
  'document.rename': 'editor',
  'document.move': 'editor',
  'document.delete': 'admin',
  'document.share': 'admin',
  'document.history.read': 'commenter',
  'document.history.restore': 'editor',
  'workspace.read': 'viewer',
  'workspace.createDocument': 'editor',
  'workspace.invite': 'admin',
  'workspace.manageMembers': 'admin',
  'workspace.rename': 'admin',
  'workspace.delete': 'owner',
};

export function rankOf(role: AccessRole): number {
  return ROLE_RANK[role];
}

export function isAtLeast(role: AccessRole, minimum: AccessRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function highestRole(...roles: (AccessRole | null | undefined)[]): AccessRole | null {
  let best: AccessRole | null = null;
  for (const role of roles) {
    if (!role) continue;
    if (best === null || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

export function can(role: AccessRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return isAtLeast(role, MINIMUM_ROLE_FOR_CAPABILITY[capability]);
}

export function capabilitiesFor(role: AccessRole | null | undefined): Capability[] {
  if (!role) return [];
  return CAPABILITIES.filter((capability) => can(role, capability));
}

export const SHAREABLE_ROLES: AccessRole[] = ['viewer', 'commenter', 'editor'];

export const WORKSPACE_MEMBER_ROLES: AccessRole[] = ['viewer', 'commenter', 'editor', 'admin'];
