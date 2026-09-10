'use client';

import { AuthGate } from '@/components/auth-gate';
import { DocumentView } from '@/components/document-view';

export function DocumentRoute({
  documentId,
  shareToken,
}: {
  documentId: string;
  shareToken: string | null;
}) {
  if (shareToken) {
    return <DocumentView documentId={documentId} shareToken={shareToken} />;
  }

  return (
    <AuthGate>
      <DocumentView documentId={documentId} shareToken={null} />
    </AuthGate>
  );
}
