'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { AuthResult, TwoFactorRequired } from '@collaby/shared';
import { AuthShell } from '@/components/auth-shell';
import { Banner, Button, Field, Input, Spinner } from '@/components/ui';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

type LoginResponse = AuthResult | TwoFactorRequired;

function isTwoFactorRequired(value: LoginResponse): value is TwoFactorRequired {
  return 'status' in value && value.status === 'two_factor_required';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const applyAuthResult = useSession((state) => state.applyAuthResult);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'password' | 'passkey' | 'code' | null>(null);
  const [ssoName, setSsoName] = useState<string | null>(null);

  useEffect(() => {
    const reason = params.get('error');
    if (!reason) return;

    setError(
      reason === 'sso_unverified'
        ? 'Your identity provider has not verified that email address yet.'
        : reason === 'registration_disabled'
          ? 'This instance is not accepting new accounts.'
          : reason === 'sso_unavailable'
            ? 'Single sign-on is not reachable right now. Try again or use your password.'
            : 'Single sign-on did not complete. Try again or use your password.',
    );
  }, [params]);

  useEffect(() => {
    api
      .get<{ oidc: { name: string } | null }>('/api/auth/providers', { skipAuthRefresh: true })
      .then((providers) => setSsoName(providers.oidc?.name ?? null))
      .catch(() => setSsoName(null));
  }, []);

  async function finish(result: AuthResult) {
    await applyAuthResult(result);
    router.replace('/');
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending('password');

    try {
      const result = await api.post<LoginResponse>(
        '/api/auth/login',
        { email, password },
        { skipAuthRefresh: true },
      );

      if (isTwoFactorRequired(result)) {
        setChallengeToken(result.challengeToken);
        return;
      }

      await finish(result);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Sign in failed.');
    } finally {
      setPending(null);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setPending('code');

    try {
      const result = await api.post<AuthResult>(
        '/api/auth/2fa/verify',
        { challengeToken, code },
        { skipAuthRefresh: true },
      );
      await finish(result);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That code did not work.');
    } finally {
      setPending(null);
    }
  }

  async function signInWithPasskey() {
    setError(null);
    setPending('passkey');

    try {
      const start = await api.post<{
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>('/api/auth/passkey/login/start', undefined, { skipAuthRefresh: true });

      const response = await startAuthentication({ optionsJSON: start.options });

      const result = await api.post<AuthResult>(
        '/api/auth/passkey/login/finish',
        { challengeId: start.challengeId, response },
        { skipAuthRefresh: true },
      );

      await finish(result);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'NotAllowedError') {
        setError(null);
      } else {
        setError(
          cause instanceof ApiRequestError
            ? cause.message
            : 'No passkey was available for this device.',
        );
      }
    } finally {
      setPending(null);
    }
  }

  if (challengeToken) {
    return (
      <AuthShell
        title="Two-factor code"
        subtitle="Enter the 6-digit code from your authenticator app."
      >
        <form onSubmit={submitCode} className="flex flex-col gap-4">
          {error ? <Banner>{error}</Banner> : null}

          <Field label="Code" hint="A recovery code works here too.">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
            />
          </Field>

          <Button type="submit" variant="primary" disabled={pending !== null}>
            {pending === 'code' ? <Spinner /> : null}
            Verify
          </Button>

          <Button variant="ghost" size="sm" onClick={() => setChallengeToken(null)}>
            Back to sign in
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Pick up where your workspace left off."
      footer={
        <>
          No account yet?{' '}
          <Link href="/register" className="text-lull-400 hover:text-lull-300">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submitPassword} className="flex flex-col gap-4">
        {error ? <Banner>{error}</Banner> : null}

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username webauthn"
            required
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" variant="primary" disabled={pending !== null}>
          {pending === 'password' ? <Spinner /> : null}
          Sign in
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-dusk">
        <span className="h-px flex-1 bg-night-600" />
        or
        <span className="h-px flex-1 bg-night-600" />
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="outline" onClick={signInWithPasskey} disabled={pending !== null}>
          {pending === 'passkey' ? <Spinner /> : null}
          Continue with a passkey
        </Button>

        {ssoName ? (
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = `${api.baseUrl}/api/auth/oidc/start`;
            }}
          >
            Continue with {ssoName}
          </Button>
        ) : null}
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center">
          <Spinner />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
