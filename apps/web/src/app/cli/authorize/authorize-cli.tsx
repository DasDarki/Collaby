'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Folder, Terminal, User, Users } from 'lucide-react';
import type { DocumentNode, WorkspaceSummary } from '@collaby/shared';
import { Banner, Button, Input, Spinner } from '@/components/ui';
import { Wordmark } from '@/components/wordmark';
import { ApiRequestError, api } from '@/lib/api';
import { cn } from '@/lib/cn';

interface DeviceRequest {
  userCode: string;
  clientName: string;
  hostname: string | null;
  platform: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

interface FolderNode {
  id: string;
  title: string;
  workspaceId: string;
  parentFolderId: string | null;
  children: FolderNode[];
}

type Phase = 'enter' | 'loading' | 'review' | 'approved' | 'denied';

function buildFolderTrees(workspaceId: string, documents: DocumentNode[]): FolderNode[] {
  const folders = documents.filter((document) => document.isFolder);
  const byId = new Map(documents.map((document) => [document.id, document]));
  const nodes = new Map<string, FolderNode>();

  for (const folder of folders) {
    let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    while (parent && !parent.isFolder)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;

    nodes.set(folder.id, {
      id: folder.id,
      title: folder.title,
      workspaceId,
      parentFolderId: parent?.id ?? null,
      children: [],
    });
  }

  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentFolderId ? nodes.get(node.parentFolderId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => a.title.localeCompare(b.title));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

function minutesLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000));
}

function CheckRow({
  label,
  icon,
  checked,
  implied,
  depth,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  checked: boolean;
  implied: boolean;
  depth: number;
  onToggle: () => void;
}) {
  const on = checked || implied;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={implied}
      disabled={implied}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[13px] transition-colors',
        implied ? 'cursor-default text-dusk' : 'text-haze hover:bg-night-750 hover:text-moon',
      )}
      style={{ paddingLeft: 8 + depth * 18 }}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
          on ? 'border-lull-400 bg-lull-400 text-night-900' : 'border-night-500',
          implied && 'opacity-60',
        )}
      >
        {on ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      <span className="shrink-0 text-dusk">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function AuthorizeCli({ initialCode }: { initialCode: string | null }) {
  const [phase, setPhase] = useState<Phase>(initialCode ? 'loading' : 'enter');
  const [code, setCode] = useState(initialCode ?? '');
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [folderTrees, setFolderTrees] = useState<Record<string, FolderNode[]>>({});
  const [mode, setMode] = useState<'all' | 'custom'>('custom');
  const [chosenWorkspaces, setChosenWorkspaces] = useState<Set<string>>(new Set());
  const [chosenFolders, setChosenFolders] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);

  const lookup = useCallback(async (value: string) => {
    setError(null);
    setPhase('loading');

    try {
      const found = await api.get<DeviceRequest>(
        `/api/cli/requests/${encodeURIComponent(value.trim())}`,
      );
      const spaces = await api.get<WorkspaceSummary[]>('/api/workspaces');
      const trees: Record<string, FolderNode[]> = {};

      await Promise.all(
        spaces.map(async (workspace) => {
          const documents = await api.get<DocumentNode[]>(
            `/api/workspaces/${workspace.id}/documents`,
          );
          trees[workspace.id] = buildFolderTrees(workspace.id, documents);
        }),
      );

      setRequest(found);
      setWorkspaces(spaces);
      setFolderTrees(trees);
      setPhase('review');
    } catch (cause) {
      setRequest(null);
      setError(
        cause instanceof ApiRequestError && cause.status === 404
          ? 'No sign-in request is waiting for that code. It may have expired, run collaby setup again.'
          : 'Could not load that request.',
      );
      setPhase('enter');
    }
  }, []);

  useEffect(() => {
    if (initialCode) void lookup(initialCode);
  }, [initialCode, lookup]);

  useEffect(() => {
    if (phase !== 'review') return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const folderAncestors = useMemo(() => {
    const ancestors = new Map<string, string[]>();
    const walk = (nodes: FolderNode[], chain: string[]) => {
      for (const node of nodes) {
        ancestors.set(node.id, chain);
        walk(node.children, [...chain, node.id]);
      }
    };
    Object.values(folderTrees).forEach((roots) => walk(roots, []));
    return ancestors;
  }, [folderTrees]);

  const folderWorkspace = useMemo(() => {
    const owners = new Map<string, string>();
    const walk = (nodes: FolderNode[]) =>
      nodes.forEach((node) => {
        owners.set(node.id, node.workspaceId);
        walk(node.children);
      });
    Object.values(folderTrees).forEach(walk);
    return owners;
  }, [folderTrees]);

  function isFolderImplied(folderId: string): boolean {
    const workspaceId = folderWorkspace.get(folderId);
    if (workspaceId && chosenWorkspaces.has(workspaceId)) return true;
    return (folderAncestors.get(folderId) ?? []).some((ancestor) => chosenFolders.has(ancestor));
  }

  function toggle(set: Set<string>, id: string, update: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  }

  const selectedFolders = [...chosenFolders].filter((id) => !isFolderImplied(id));
  const nothingChosen =
    mode === 'custom' && chosenWorkspaces.size === 0 && selectedFolders.length === 0;

  async function decide(approve: boolean) {
    if (!request) return;
    setBusy(true);
    setError(null);

    try {
      if (approve) {
        const scope =
          mode === 'all'
            ? { all: true }
            : { all: false, workspaces: [...chosenWorkspaces], folders: selectedFolders };
        await api.post(`/api/cli/requests/${request.userCode}/approve`, { scope });
        setPhase('approved');
      } else {
        await api.post(`/api/cli/requests/${request.userCode}/deny`);
        setPhase('denied');
      }
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  function renderFolders(nodes: FolderNode[], depth: number): React.ReactNode {
    return nodes.map((node) => (
      <div key={node.id}>
        <CheckRow
          label={node.title}
          icon={<Folder size={13} />}
          checked={chosenFolders.has(node.id)}
          implied={isFolderImplied(node.id)}
          depth={depth}
          onToggle={() => toggle(chosenFolders, node.id, setChosenFolders)}
        />
        {renderFolders(node.children, depth + 1)}
      </div>
    ));
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[460px]">
        <div className="mb-8">
          <Wordmark size={24} />
        </div>

        {phase === 'loading' ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : null}

        {phase === 'enter' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim().length > 0) void lookup(code);
            }}
            className="flex flex-col gap-4"
          >
            <div>
              <h1 className="text-[15px] font-medium text-moon">Sign in the Collaby CLI</h1>
              <p className="mt-1 text-[13px] text-dusk">Enter the code your terminal is showing.</p>
            </div>
            {error ? <Banner>{error}</Banner> : null}
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="ABCD-EFGH"
              aria-label="Code from the terminal"
              autoFocus
              className="text-center font-mono text-[15px] tracking-[0.25em] uppercase"
            />
            <Button type="submit" variant="primary">
              Continue
            </Button>
          </form>
        ) : null}

        {phase === 'review' && request ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-night-600 bg-night-800 text-lull-300">
                <Terminal size={17} />
              </span>
              <div className="min-w-0">
                <h1 className="text-[15px] font-medium text-moon">Allow the Collaby CLI?</h1>
                <p className="mt-0.5 text-[13px] leading-relaxed text-haze">
                  <span className="text-moon">
                    {request.clientName}
                    {request.hostname ? ` on ${request.hostname}` : ''}
                  </span>{' '}
                  wants to keep a read-only copy of your pages on that machine.
                </p>
                <p className="mt-1 font-mono text-[11px] text-dusk">
                  {request.platform ?? 'unknown platform'}
                  {request.ipAddress ? ` · ${request.ipAddress}` : ''} · expires in{' '}
                  {minutesLeft(request.expiresAt)} min
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-night-600 bg-night-850 px-4 py-3 text-center">
              <p className="font-mono text-[22px] tracking-[0.3em] text-moon">{request.userCode}</p>
              <p className="mt-1 text-[12px] text-dusk">
                Only continue if your terminal shows this exact code.
              </p>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-dusk">
                What it can read
              </p>

              <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-night-600 bg-night-850 p-1">
                {(['custom', 'all'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    onClick={() => setMode(option)}
                    className={cn(
                      'rounded-md py-1.5 text-[12.5px] transition-colors',
                      mode === option ? 'bg-night-700 text-moon' : 'text-dusk hover:text-moon',
                    )}
                  >
                    {option === 'custom' ? 'Only what I choose' : 'All my workspaces'}
                  </button>
                ))}
              </div>

              {mode === 'all' ? (
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-dusk">
                  Every workspace you are a member of, including ones you join later.
                </p>
              ) : (
                <div className="mt-2.5 max-h-[280px] overflow-y-auto rounded-lg border border-night-600 bg-night-850 p-1">
                  {workspaces.map((workspace) => (
                    <div key={workspace.id}>
                      <CheckRow
                        label={workspace.name}
                        icon={
                          workspace.kind === 'personal' ? <User size={13} /> : <Users size={13} />
                        }
                        checked={chosenWorkspaces.has(workspace.id)}
                        implied={false}
                        depth={0}
                        onToggle={() => toggle(chosenWorkspaces, workspace.id, setChosenWorkspaces)}
                      />
                      {renderFolders(folderTrees[workspace.id] ?? [], 1)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[12.5px] leading-relaxed text-dusk">
              It can read and download these pages. It cannot edit, share or delete anything, and
              you can sign it out at any time under Settings, Devices.
            </p>

            {error ? <Banner>{error}</Banner> : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => void decide(false)}>
                Decline
              </Button>
              <Button
                variant="primary"
                disabled={busy || nothingChosen}
                onClick={() => void decide(true)}
              >
                {busy ? <Spinner /> : null}
                Allow read access
              </Button>
            </div>
          </div>
        ) : null}

        {phase === 'approved' ? (
          <div className="flex flex-col gap-2">
            <h1 className="flex items-center gap-2 text-[15px] font-medium text-moon">
              <Check size={16} className="text-leaf" />
              The CLI is signed in
            </h1>
            <p className="text-[13px] leading-relaxed text-dusk">
              You can close this tab and go back to your terminal.
            </p>
          </div>
        ) : null}

        {phase === 'denied' ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-[15px] font-medium text-moon">Declined</h1>
            <p className="text-[13px] leading-relaxed text-dusk">
              The CLI stops waiting and nothing was shared.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
