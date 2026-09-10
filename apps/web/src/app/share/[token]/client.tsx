'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Banner, Button, Field, Input, Spinner } from '@/components/ui';
import { ApiRequestError, api } from '@/lib/api';

interface ShareInfo {
  role: string;
  documentId: string | null;
  workspaceId: string | null;
  requiresPassword: boolean;
}

export function ShareRoute({ token }: { token: string }) {
  const router = useRouter();

  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openDocument(documentId: string) {
    router.replace(`/d/${documentId}?share=${encodeURIComponent(token)}`);
  }

  useEffect(() => {
    const stored = sessionStorage.getItem(`collaby.share.${token}`);
    if (stored) api.setShareGrant(stored);

    api
      .get<ShareInfo>(`/api/share/${token}`, { skipAuthRefresh: true })
      .then((result) => {
        setInfo(result);
        if (!result.requiresPassword && result.documentId) {
          openDocument(result.documentId);
        }
      })
      .catch(() => setError('This link is no longer available.'));
  }, [token]);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await api.post<{ grantToken: string; documentId: string | null }>(
        `/api/share/${token}/unlock`,
        { password },
        { skipAuthRefresh: true },
      );

      sessionStorage.setItem(`collaby.share.${token}`, result.grantToken);
      api.setShareGrant(result.grantToken);

      if (result.documentId) openDocument(result.documentId);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not open the link.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !info) {
    return (
      <AuthShell title="Link unavailable" subtitle="Ask the owner for a new one.">
        <Banner>{error}</Banner>
      </AuthShell>
    );
  }

  if (!info) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }

  if (!info.requiresPassword) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }

  return (
    <AuthShell title="This page is locked" subtitle="Enter the password you were given.">
      <form onSubmit={unlock} className="flex flex-col gap-4">
        {error ? <Banner>{error}</Banner> : null}

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            required
          />
        </Field>

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Spinner /> : null}
          Open page
        </Button>
      </form>
    </AuthShell>
  );
}
