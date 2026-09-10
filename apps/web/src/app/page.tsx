'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGate } from '@/components/auth-gate';
import { Button, Spinner } from '@/components/ui';
import { SearchDialog, useGlobalSearch } from '@/components/search-dialog';
import { Wordmark } from '@/components/wordmark';
import { useWorkspaces } from '@/lib/workspace-store';

function Landing() {
  const router = useRouter();
  const { loadWorkspaces, loadDocuments, createDocument } = useWorkspaces();
  const [ready, setReady] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const search = useGlobalSearch();

  useEffect(() => {
    async function start() {
      const workspaces = await loadWorkspaces();
      const first = workspaces[0];
      if (!first) {
        setReady(true);
        return;
      }

      setWorkspaceId(first.id);
      await loadDocuments(first.id);

      const documents = useWorkspaces.getState().documents;
      const entry = documents.find((document) => document.parentId === null) ?? documents[0];

      if (entry) {
        router.replace(`/d/${entry.id}`);
        return;
      }

      setReady(true);
    }

    void start();
  }, [loadWorkspaces, loadDocuments, router]);

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark size={30} />
      <div className="max-w-[380px]">
        <h1 className="text-[15px] font-medium text-moon">Your workspace is empty</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dusk">
          Every page is a markdown file with full version history. Start with one.
        </p>
      </div>
      <Button
        variant="primary"
        onClick={async () => {
          if (!workspaceId) return;
          const document = await createDocument({ workspaceId, title: 'Untitled' });
          router.push(`/d/${document.id}`);
        }}
      >
        Create your first page
      </Button>

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
