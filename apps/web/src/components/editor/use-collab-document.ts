'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { PresenceUser } from '@collaby/shared';
import { api, collabEndpoint } from '@/lib/api';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'denied';

export interface CollabDocument {
  provider: HocuspocusProvider | null;
  status: CollabStatus;
  synced: boolean;
  peers: PresenceUser[];
}

export interface CollabIdentity {
  userId: string;
  displayName: string;
  avatarColor: string;
  avatarUrl: string | null;
}

export function awarenessPayload(identity: CollabIdentity) {
  return {
    userId: identity.userId,
    displayName: identity.displayName,
    avatarColor: identity.avatarColor,
    avatarUrl: identity.avatarUrl,
    name: identity.displayName,
    color: identity.avatarColor,
  };
}

export function useCollabDocument(
  documentId: string,
  identity: CollabIdentity | null,
  shareToken: string | null,
): CollabDocument {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<PresenceUser[]>([]);
  const identityRef = useRef(identity);

  identityRef.current = identity;

  const url = useMemo(() => {
    const endpoint = collabEndpoint();
    return shareToken ? `${endpoint}?shareToken=${encodeURIComponent(shareToken)}` : endpoint;
  }, [shareToken]);

  useEffect(() => {
    let disposed = false;

    const instance = new HocuspocusProvider({
      url,
      name: documentId,
      token: () => api.token ?? '',
      onStatus({ status: next }) {
        if (disposed) return;
        setStatus(next === 'connected' ? 'connected' : 'disconnected');
      },
      onAuthenticationFailed() {
        if (!disposed) setStatus('denied');
      },
      onSynced() {
        if (!disposed) setSynced(true);
      },
      onAwarenessChange({ states }) {
        if (disposed) return;

        const seen = new Map<string, PresenceUser>();

        for (const state of states) {
          const user = (state as { user?: Record<string, unknown> }).user;
          if (!user) continue;

          const displayName =
            typeof user.displayName === 'string'
              ? user.displayName
              : typeof user.name === 'string'
                ? user.name
                : null;

          if (!displayName) continue;

          const avatarColor =
            typeof user.avatarColor === 'string'
              ? user.avatarColor
              : typeof user.color === 'string'
                ? user.color
                : '#7c9cff';

          const key = typeof user.userId === 'string' ? user.userId : String(state.clientId);

          if (!seen.has(key)) {
            seen.set(key, {
              clientId: state.clientId as number,
              userId: key,
              displayName,
              avatarColor,
              avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
            });
          }
        }

        setPeers([...seen.values()]);
      },
    });

    setProvider(instance);

    return () => {
      disposed = true;
      instance.destroy();
      setProvider(null);
      setSynced(false);
    };
  }, [documentId, url]);

  useEffect(() => {
    if (!provider || !identity) return;

    provider.setAwarenessField('user', awarenessPayload(identity));
  }, [provider, identity]);

  return { provider, status, synced, peers };
}
