'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import { takeReturnPath } from '@/lib/return-path';
import { useSession } from '@/lib/session';

export default function AuthCallbackPage() {
  const router = useRouter();
  const bootstrap = useSession((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap().then(() => router.replace(takeReturnPath()));
  }, [bootstrap, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center gap-2 text-[13px] text-dusk">
      <Spinner />
      Finishing sign in
    </main>
  );
}
