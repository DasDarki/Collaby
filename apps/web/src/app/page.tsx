'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkspaceSummary } from '@collaby/shared';
import { AuthGate } from '@/components/auth-gate';
import { SearchDialog, useGlobalSearch } from '@/components/search-dialog';
import { Button, Spinner } from '@/components/ui';
import { Wordmark } from '@/components/wordmark';
import { api } from '@/lib/api';
import { useWorkspaces } from '@/lib/workspace-store';

interface LandingTarget {
  workspaceId: string | null;
  documentId: string | null;
}

function Landing() {
  const router = useRouter();
  const { loadWorkspaces, loadDocuments, createDocument } = useWorkspaces();
  const [ready, setReady] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [switching, setSwitching] = useState(false);
  const search = useGlobalSearch();

  const settle = useCallback(
    async (landing: LandingTarget) => {
      if (landing.documentId) {
        router.replace(`/d/${landing.documentId}`);
        return;
      }

      setWorkspaces(await loadWorkspaces());
      setWorkspaceId(landing.workspaceId);
      if (landing.workspaceId) await loadDocuments(landing.workspaceId);
      setReady(true);
    },
    [router, loadWorkspaces, loadDocuments],
  );

  useEffect(() => {
    void api.get<LandingTarget>('/api/account/landing').then(settle);
  }, [settle]);

  async function switchTo(nextWorkspaceId: string) {
    setSwitching(true);
    try {
      await api.put('/api/account/last-location', {
        workspaceId: nextWorkspaceId,
        documentId: null,
      });
      await settle(await api.get<LandingTarget>('/api/account/landing'));
    } finally {
      setSwitching(false);
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }

  const current = workspaces.find((workspace) => workspace.id === workspaceId);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark size={30} />
      <div className="max-w-[380px]">
        <h1 className="text-[15px] font-medium text-moon">
          {current ? `${current.name} is empty` : 'Your workspace is empty'}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dusk">
          Every page is a markdown file with full version history. Start with one.
        </p>
      </div>

      <Button
        variant="primary"
        disabled={!workspaceId}
        onClick={async () => {
          if (!workspaceId) return;
          const document = await createDocument({ workspaceId, title: 'Untitled' });
          router.push(`/d/${document.id}`);
        }}
      >
        Create your first page
      </Button>

      {workspaces.length > 1 ? (
        <label className="flex items-center gap-2 text-[12.5px] text-dusk">
          or open
          <select
            value={workspaceId ?? ''}
            disabled={switching}
            onChange={(event) => void switchTo(event.target.value)}
            aria-label="Open another workspace"
            className="h-8 cursor-pointer rounded-md border border-night-600 bg-night-800 px-2 text-[12.5px] text-moon hover:border-night-500 focus:border-lull-400 focus:outline-none"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <SearchDialog
        open={search.open}
        workspaceId={workspaceId}
        onClose={() => search.setOpen(false)}
      />
    </main>
  );
}

export default function HomePage() {
  return (
    <AuthGate>
      <Landing />
    </AuthGate>
  );
}
