'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import { useSession } from '@/lib/session';

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, bootstrap } = useSession();

  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status !== 'anonymous') return;
    const here = `${window.location.pathname}${window.location.search}`;
    router.replace(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`);
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }

  return <>{children}</>;
}
