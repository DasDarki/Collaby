'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import type { PasskeySummary, SessionDevice } from '@collaby/shared';
import { ArrowLeft, KeyRound, LogOut, Monitor, ShieldCheck, Trash2 } from 'lucide-react';
import { AuthGate } from '@/components/auth-gate';
import { Avatar, Banner, Button, Field, Input, Spinner } from '@/components/ui';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-night-600 bg-night-850">
      <div className="flex items-start gap-2.5 border-b border-night-600 px-5 py-4">
        <span className="mt-0.5 text-dusk">{icon}</span>
        <div>
          <h2 className="text-[13.5px] font-medium text-moon">{title}</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-dusk">{description}</p>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function SettingsContent() {
  const router = useRouter();
  const { user, refreshAccount, signOut } = useSession();

  const [sessions, setSessions] = useState<SessionDevice[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [passkeyLabel, setPasskeyLabel] = useState('');
  const [totpSetup, setTotpSetup] = useState<{ secret: string; provisioningUri: string } | null>(
    null,
  );
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const [deviceList, passkeyList] = await Promise.all([
      api.get<SessionDevice[]>('/api/account/sessions'),
      api.get<PasskeySummary[]>('/api/account/passkeys'),
    ]);
    setSessions(deviceList);
    setPasskeys(passkeyList);
  }, []);

  useEffect(() => {
    void load().catch(() => setError('Could not load your account settings.'));
  }, [load]);

  async function addPasskey(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const start = await api.post<{
        challengeId: string;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>('/api/account/passkeys/register/start');

      const response = await startRegistration({ optionsJSON: start.options });

      await api.post('/api/account/passkeys/register/finish', {
        label: passkeyLabel.trim() || 'This device',
        response,
      });

      setPasskeyLabel('');
      await load();
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'NotAllowedError')) {
        setError(cause instanceof ApiRequestError ? cause.message : 'Could not add the passkey.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function startTwoFactor() {
    setError(null);
    try {
      setTotpSetup(
        await api.post<{ secret: string; provisioningUri: string }>('/api/account/2fa/setup'),
      );
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not start the setup.');
    }
  }

  async function enableTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await api.post<{ recoveryCodes: string[] }>('/api/account/2fa/enable', {
        code: totpCode,
      });
      setRecoveryCodes(result.recoveryCodes);
      setTotpSetup(null);
      setTotpCode('');
      await refreshAccount();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function disableTwoFactor() {
    const code = window.prompt('Enter a current authenticator code to turn off two-factor');
    if (!code) return;

    try {
      await api.post('/api/account/2fa/disable', { code });
      await refreshAccount();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not turn it off.');
    }
  }

  return (
    <main className="mx-auto w-full max-w-[620px] px-5 py-10">
      <Link
        href="/"
        className="mb-7 inline-flex items-center gap-1.5 text-[12.5px] text-dusk hover:text-moon"
      >
        <ArrowLeft size={13} />
        Back to your pages
      </Link>

      <header className="mb-7 flex items-center gap-3">
        {user ? (
          <Avatar name={user.displayName} color={user.avatarColor} url={user.avatarUrl} size={38} />
        ) : null}
        <div>
          <h1 className="text-[15px] font-medium text-moon">{user?.displayName}</h1>
          <p className="text-[12.5px] text-dusk">{user?.email}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void signOut().then(() => router.replace('/login'))}
        >
          <LogOut size={12} />
          Sign out
        </Button>
      </header>

      {error ? (
        <div className="mb-4">
          <Banner>{error}</Banner>
        </div>
      ) : null}

      <div className="space-y-4">
        <Section
          title="Devices"
          description="Every sign in gets its own session. Ending one signs that device out immediately."
          icon={<Monitor size={15} />}
        >
          <ul className="space-y-1.5">
            {sessions.map((device) => (
              <li
                key={device.id}
                className="flex items-center gap-3 rounded-lg border border-night-600 bg-night-800 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] text-moon">
                    {device.deviceName}
                    {device.isCurrent ? (
                      <span className="rounded border border-leaf/40 px-1 py-px text-[10px] uppercase tracking-wide text-leaf">
                        this device
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-dusk">
                    {device.ipAddress ?? 'unknown ip'} · active {relativeTime(device.lastSeenAt)}
                  </p>
                </div>

                {device.isCurrent ? null : (
                  <button
                    type="button"
                    aria-label={`Sign out ${device.deviceName}`}
                    onClick={async () => {
                      await api.delete(`/api/account/sessions/${device.id}`);
                      await load();
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-alarm"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {sessions.length > 1 ? (
            <Button
              variant="danger"
              size="sm"
              className="mt-3"
              onClick={async () => {
                await api.post('/api/account/sessions/revoke-others');
                await load();
              }}
            >
              Sign out every other device
            </Button>
          ) : null}
        </Section>

        <Section
          title="Passkeys"
          description="Sign in without typing anything. Your device picks the right passkey on its own."
          icon={<KeyRound size={15} />}
        >
          {passkeys.length > 0 ? (
            <ul className="mb-3 space-y-1.5">
              {passkeys.map((passkey) => (
                <li
                  key={passkey.id}
                  className="flex items-center gap-3 rounded-lg border border-night-600 bg-night-800 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-moon">{passkey.label}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-dusk">
                      {passkey.backedUp ? 'synced' : 'this device only'} ·{' '}
                      {passkey.lastUsedAt
                        ? `used ${relativeTime(passkey.lastUsedAt)}`
                        : 'never used'}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${passkey.label}`}
                    onClick={async () => {
                      await api.delete(`/api/account/passkeys/${passkey.id}`);
                      await load();
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded text-dusk hover:bg-night-700 hover:text-alarm"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <form onSubmit={addPasskey} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Name this passkey" hint="Only used to tell them apart in this list.">
                <Input
                  value={passkeyLabel}
                  onChange={(event) => setPasskeyLabel(event.target.value)}
                  placeholder="Work laptop"
                />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <Spinner /> : null}
              Add passkey
            </Button>
          </form>
        </Section>

        <Section
          title="Two-factor authentication"
          description="Ask for a code from your authenticator app after the password step."
          icon={<ShieldCheck size={15} />}
        >
          {recoveryCodes ? (
            <div className="mb-4 rounded-lg border border-lamp/40 bg-lamp/10 p-3">
              <p className="text-[12.5px] text-lamp">
                Save these recovery codes now. Each one works once if you lose your device.
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[12px] text-moon">
                {recoveryCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setRecoveryCodes(null)}
              >
                I saved them
              </Button>
            </div>
          ) : null}

          {user?.twoFactorEnabled ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[13px] text-leaf">
                <ShieldCheck size={14} />
                Two-factor is on
              </span>
              <Button variant="danger" size="sm" className="ml-auto" onClick={disableTwoFactor}>
                Turn off
              </Button>
            </div>
          ) : totpSetup ? (
            <form onSubmit={enableTwoFactor} className="flex flex-col gap-3">
              <p className="text-[12.5px] leading-relaxed text-haze">
                Add this secret to your authenticator app, then enter the code it shows.
              </p>
              <code className="block break-all rounded-md border border-night-600 bg-night-900 px-3 py-2 font-mono text-[12.5px] text-lull-300">
                {totpSetup.secret}
              </code>

              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Code from your app">
                    <Input
                      value={totpCode}
                      onChange={(event) => setTotpCode(event.target.value)}
                      inputMode="numeric"
                      placeholder="123456"
                      className="font-mono tracking-[0.3em]"
                      autoFocus
                    />
                  </Field>
                </div>
                <Button type="submit" variant="primary" disabled={busy}>
                  Turn on
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" onClick={startTwoFactor}>
              Set up two-factor
            </Button>
          )}
        </Section>
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsContent />
    </AuthGate>
  );
}
