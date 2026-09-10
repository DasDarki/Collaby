'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Link2, Trash2, UserPlus } from 'lucide-react';
import type { AccessRole, ShareLink, WorkspaceSummary } from '@collaby/shared';
import { can } from '@collaby/shared';
import { AuthGate } from '@/components/auth-gate';
import { Avatar, Banner, Button, Field, Input, Spinner } from '@/components/ui';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Member {
  userId: string;
  email: string;
  displayName: string;
  avatarColor: string;
  avatarUrl: string | null;
  role: AccessRole;
  joinedAt: string;
}

interface WorkspaceDetail extends Omit<WorkspaceSummary, 'memberCount'> {
  role: AccessRole;
}

const MEMBER_ROLES: AccessRole[] = ['viewer', 'commenter', 'editor', 'admin'];

function MembersContent({ workspaceId }: { workspaceId: string }) {
  const user = useSession((state) => state.user);

  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AccessRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const detail = await api.get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`);
    setWorkspace(detail);
    setMembers(await api.get<Member[]>(`/api/workspaces/${workspaceId}/members`));

    if (can(detail.role, 'workspace.invite')) {
      setLinks(await api.get<ShareLink[]>(`/api/workspaces/${workspaceId}/share-links`));
    }
  }, [workspaceId]);

  useEffect(() => {
    void load().catch(() => setError('This workspace is not available to you.'));
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await api.post(`/api/workspaces/${workspaceId}/members`, { email, role });
      setEmail('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not add that person.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !workspace) {
    return (
      <main className="mx-auto w-full max-w-[620px] px-5 py-10">
        <Banner>{error}</Banner>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }

  const canInvite = can(workspace.role, 'workspace.invite');
  const canManage = can(workspace.role, 'workspace.manageMembers');

  return (
    <main className="mx-auto w-full max-w-[620px] px-5 py-10">
      <Link
        href="/"
        className="mb-7 inline-flex items-center gap-1.5 text-[12.5px] text-dusk hover:text-moon"
      >
        <ArrowLeft size={13} />
        Back to your pages
      </Link>

      <header className="mb-7">
        <h1 className="text-[16px] font-medium text-moon">{workspace.name}</h1>
        <p className="mt-0.5 text-[12.5px] text-dusk">
          {members.length} member{members.length === 1 ? '' : 's'} · you are {workspace.role}
        </p>
      </header>

      {error ? (
        <div className="mb-4">
          <Banner>{error}</Banner>
        </div>
      ) : null}

      {canInvite ? (
        <form onSubmit={invite} className="mb-6 flex items-end gap-2">
          <div className="flex-1">
            <Field label="Add someone" hint="They need a Collaby account already.">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
              />
            </Field>
          </div>
          <select
            value={role}
            aria-label="Role for the new member"
            onChange={(event) => setRole(event.target.value as AccessRole)}
            className="h-9 rounded-md border border-night-600 bg-night-850 px-2 text-[12.5px] text-moon hover:border-night-500 focus:border-lull-400 focus:outline-none"
          >
            {MEMBER_ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : <UserPlus size={13} />}
            Add
          </Button>
        </form>
      ) : null}

      <ul className="space-y-1.5">
        {members.map((member) => {
          const isOwner = member.role === 'owner';
          const isSelf = member.userId === user?.id;

          return (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-lg border border-night-600 bg-night-850 px-3 py-2"
            >
              <Avatar
                name={member.displayName}
                color={member.avatarColor}
                url={member.avatarUrl}
                size={28}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-moon">
                  {member.displayName}
                  {isSelf ? <span className="ml-1.5 text-[11.5px] text-dusk">you</span> : null}
                </p>
                <p className="truncate text-[11.5px] text-dusk">{member.email}</p>
              </div>

              {canManage && !isOwner ? (
                <select
                  value={member.role}
                  aria-label={`Role for ${member.displayName}`}
                  onChange={async (event) => {
                    await api.patch(`/api/workspaces/${workspaceId}/members/${member.userId}`, {
                      role: event.target.value,
                    });
                    await load();
                  }}
                  className="h-7 rounded border border-night-600 bg-night-800 px-1.5 text-[12px] text-moon hover:border-night-500 focus:border-lull-400 focus:outline-none"
                >
                  {MEMBER_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[12px] capitalize text-haze">{member.role}</span>
              )}

              {canManage && !isOwner && !isSelf ? (
                <button
                  type="button"
                  aria-label={`Remove ${member.displayName}`}
                  onClick={async () => {
                    await api.delete(`/api/workspaces/${workspaceId}/members/${member.userId}`);
                    await load();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-alarm"
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canInvite ? (
        <section className="mt-8 border-t border-night-600 pt-6">
          <h2 className="text-[13.5px] font-medium text-moon">Workspace links</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-dusk">
            Anyone with the link gets this role on every page in the workspace.
          </p>

          <div className="mt-3 flex items-end gap-2">
            <select
              defaultValue="viewer"
              aria-label="Role for the workspace link"
              id="workspace-link-role"
              className="h-9 rounded-md border border-night-600 bg-night-850 px-2 text-[12.5px] text-moon hover:border-night-500 focus:border-lull-400 focus:outline-none"
            >
              <option value="viewer">viewer</option>
              <option value="commenter">commenter</option>
              <option value="editor">editor</option>
            </select>
            <Button
              variant="outline"
              onClick={async () => {
                const select = document.getElementById(
                  'workspace-link-role',
                ) as HTMLSelectElement | null;
                await api.post(`/api/workspaces/${workspaceId}/share-links`, {
                  role: select?.value ?? 'viewer',
                });
                await load();
              }}
            >
              <Link2 size={13} />
              Create link
            </Button>
          </div>

          {links.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {links.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center gap-2 rounded-md border border-night-600 bg-night-850 px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-haze">
                    /share/{link.token}
                  </span>
                  <span className="text-[11.5px] capitalize text-dusk">{link.role}</span>
                  <button
                    type="button"
                    aria-label="Copy link"
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        `${window.location.origin}/share/${link.token}`,
                      );
                      setCopied(link.token);
                      window.setTimeout(() => setCopied(null), 1800);
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-moon"
                  >
                    {copied === link.token ? (
                      <span className="text-[10px] text-leaf">ok</span>
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Revoke link"
                    onClick={async () => {
                      await api.delete(`/api/share-links/${link.id}`);
                      await load();
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-alarm"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

export default function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);

  return (
    <AuthGate>
      <MembersContent workspaceId={workspaceId} />
    </AuthGate>
  );
}
