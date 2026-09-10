'use client';

import { create } from 'zustand';
import type { AuthResult, PublicUser } from '@collaby/shared';
import { api } from './api';

export interface AccountDetails extends PublicUser {
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  sessionId: string;
}

interface SessionState {
  user: AccountDetails | null;
  status: 'idle' | 'loading' | 'authenticated' | 'anonymous';
  bootstrap: () => Promise<void>;
  applyAuthResult: (result: AuthResult) => Promise<void>;
  refreshAccount: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  status: 'idle',

  async bootstrap() {
    if (get().status === 'loading') return;
    set({ status: 'loading' });

    const token = await api.refresh();
    if (!token) {
      set({ user: null, status: 'anonymous' });
      return;
    }

    try {
      const account = await api.get<AccountDetails>('/api/account/me');
      set({ user: account, status: 'authenticated' });
    } catch {
      set({ user: null, status: 'anonymous' });
    }
  },

  async applyAuthResult(result) {
    api.setAccessToken(result.accessToken);
    const account = await api.get<AccountDetails>('/api/account/me');
    set({ user: account, status: 'authenticated' });
  },

  async refreshAccount() {
    if (!api.token) return;
    const account = await api.get<AccountDetails>('/api/account/me');
    set({ user: account });
  },

  async signOut() {
    try {
      await api.post('/api/auth/logout');
    } finally {
      api.setAccessToken(null);
      set({ user: null, status: 'anonymous' });
    }
  },
}));
