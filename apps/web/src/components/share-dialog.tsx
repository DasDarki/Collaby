'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Trash2, X } from 'lucide-react';
import type { AccessRole, PublicUser, ShareLink } from '@collaby/shared';
import { Avatar, Banner, Button, Field, Input, Spinner } from '@/components/ui';
import { ApiRequestError, api } from '@/lib/api';

interface DocumentGrant extends PublicUser {
  userId: string;
  role: AccessRole;
  createdAt: string;
}

const SHAREABLE: { value: AccessRole; label: string; hint: string }[] = [
  { value: 'viewer', label: 'Viewer', hint: 'Can read the page' },
  { value: 'commenter', label: 'Commenter', hint: 'Can read and comment' },
  { value: 'editor', label: 'Editor', hint: 'Can read, comment and edit' },
];

function RoleSelect({
  value,
  onChange,
  id,
}: {
  value: AccessRole;
  onChange: (role: AccessRole) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as AccessRole)}
      className="h-9 rounded-md border border-night-600 bg-night-850 px-2 text-[12.5px] text-moon hover:border-night-500 focus:border-lull-400 focus:outline-none"
    >
      {SHAREABLE.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ShareDialog({
  documentId,
  documentTitle,
  onClose,
}: {
  documentId: string;
  documentTitle: string;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<DocumentGrant[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AccessRole>('editor');
  const [linkRole, setLinkRole] = useState<AccessRole>('viewer');
  const [linkPassword, setLinkPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [people, shareLinks] = await Promise.all([
      api.get<DocumentGrant[]>(`/api/documents/${documentId}/permissions`),
      api.get<ShareLink[]>(`/api/documents/${documentId}/share-links`),
    ]);
    setGrants(people);
    setLinks(shareLinks);
  }, [documentId]);

  useEffect(() => {
    void load().catch(() => setError('Could not load the sharing settings.'));
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await api.post(`/api/documents/${documentId}/permissions`, { email, role: inviteRole });
      setEmail('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not share the page.');
    } finally {
      setBusy(false);
    }
  }

  async function createLink() {
    setError(null);
    setBusy(true);

    try {
      await api.post(`/api/documents/${documentId}/share-links`, {
        role: linkRole,
        password: linkPassword.trim().length > 0 ? linkPassword.trim() : null,
      });
      setLinkPassword('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(token);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-night-900/75 px-5 py-12 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] rounded-xl border border-night-600 bg-night-800 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-night-600 px-5 py-4">
          <div>
            <h2 id="share-title" className="text-[14px] font-medium text-moon">
              Share
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-dusk">{documentTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-dusk hover:bg-night-700 hover:text-moon"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {error ? <Banner>{error}</Banner> : null}

          <form onSubmit={invite} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Invite by email">
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </Field>
            </div>
            <RoleSelect value={inviteRole} onChange={setInviteRole} />
            <Button type="submit" variant="primary" disabled={busy}>
              Invite
            </Button>
          </form>

          {grants.length > 0 ? (
            <ul className="space-y-1.5">
              {grants.map((grant) => (
                <li key={grant.userId} className="flex items-center gap-2.5">
                  <Avatar
                    name={grant.displayName}
                    color={grant.avatarColor}
                    url={grant.avatarUrl}
                    size={24}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-moon">{grant.displayName}</p>
                    <p className="truncate text-[11.5px] text-dusk">{grant.email}</p>
                  </div>
                  <span className="text-[12px] capitalize text-haze">{grant.role}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${grant.displayName}`}
                    onClick={async () => {
                      await api.delete(`/api/documents/${documentId}/permissions/${grant.userId}`);
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

          <div className="border-t border-night-600 pt-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Share link" hint="Anyone with the link gets this role.">
                  <Input
                    type="password"
                    value={linkPassword}
                    onChange={(event) => setLinkPassword(event.target.value)}
                    placeholder="Optional password"
                  />
                </Field>
              </div>
              <RoleSelect value={linkRole} onChange={setLinkRole} />
              <Button variant="outline" onClick={createLink} disabled={busy}>
                {busy ? <Spinner /> : <Link2 size={13} />}
                Create
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
                    {link.hasPassword ? (
                      <span className="text-[10.5px] uppercase tracking-wide text-lamp">
                        locked
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Copy link"
                      onClick={() => void copyLink(link.token)}
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
          </div>
        </div>
      </div>
    </div>
  );
}
