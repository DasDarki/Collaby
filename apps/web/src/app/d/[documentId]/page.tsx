'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthGate } from '@/components/auth-gate';
import { DocumentView } from '@/components/document-view';
import { Spinner } from '@/components/ui';

function DocumentRoute({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = use(params);
  const search = useSearchParams();
  const shareToken = search.get('share');

  if (shareToken) {
    return <DocumentView documentId={documentId} shareToken={shareToken} />;
  }

  return (
    <AuthGate>
      <DocumentView documentId={documentId} shareToken={null} />
    </AuthGate>
  );
}

export default function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center">
          <Spinner />
        </main>
      }
    >
      <DocumentRoute params={params} />
    </Suspense>
  );
}
