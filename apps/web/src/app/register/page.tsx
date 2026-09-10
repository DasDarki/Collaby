'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AuthResult } from '@collaby/shared';
import { AuthShell } from '@/components/auth-shell';
import { Banner, Button, Field, Input, Spinner } from '@/components/ui';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function RegisterPage() {
  const router = useRouter();
  const applyAuthResult = useSession((state) => state.applyAuthResult);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = await api.post<AuthResult>(
        '/api/auth/register',
        { displayName, email, password },
        { skipAuthRefresh: true },
      );
      await applyAuthResult(result);
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the account.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="You get a personal workspace right away."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-lull-400 hover:text-lull-300">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Banner>{error}</Banner> : null}

        <Field label="Name">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
            required
          />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </Field>

        <Field label="Password" hint="At least 12 characters.">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Spinner /> : null}
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
