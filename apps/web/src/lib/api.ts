import type { ApiError } from '@collaby/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function absolute(path: string): URL {
  const base =
    API_URL || (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  return new URL(`${base}${path}`);
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, payload: ApiError) {
    super(payload.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = payload.error;
    this.details = payload.details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  skipAuthRefresh?: boolean;
}

type TokenListener = (token: string | null) => void;

class ApiClient {
  private accessToken: string | null = null;
  private shareGrant: string | null = null;
  private refreshInFlight: Promise<string | null> | null = null;
  private readonly listeners = new Set<TokenListener>();

  get baseUrl(): string {
    return API_URL || (typeof window === 'undefined' ? '' : window.location.origin);
  }

  get token(): string | null {
    return this.accessToken;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
    for (const listener of this.listeners) listener(token);
  }

  setShareGrant(grant: string | null): void {
    this.shareGrant = grant;
  }

  onTokenChange(listener: TokenListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(): Promise<string | null> {
    this.refreshInFlight ??= this.performRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<string | null> {
    const response = await fetch(absolute('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      this.setAccessToken(null);
      return null;
    }

    const payload = (await response.json()) as { accessToken: string };
    this.setAccessToken(payload.accessToken);
    return payload.accessToken;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = absolute(path);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }

    const send = async (token: string | null): Promise<Response> => {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = `Bearer ${token}`;
      if (this.shareGrant) headers['x-collaby-share-grant'] = this.shareGrant;

      return fetch(url, {
        method: options.method ?? 'GET',
        headers,
        credentials: 'include',
        signal: options.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    };

    let response = await send(this.accessToken);

    if (response.status === 401 && !options.skipAuthRefresh) {
      const token = await this.refresh();
      if (token) response = await send(token);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload = text.length > 0 ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        (payload as ApiError) ?? { error: 'request_failed', message: response.statusText },
      );
    }

    return payload as T;
  }

  resolveAssetUrl(src: string): string {
    if (!src.startsWith('/api/')) return src;
    return `${this.baseUrl}${src}`;
  }

  async upload<T>(path: string, file: File): Promise<T> {
    const body = new FormData();
    body.append('file', file);

    const send = async (token: string | null): Promise<Response> => {
      const headers: Record<string, string> = {};
      if (token) headers.authorization = `Bearer ${token}`;
      if (this.shareGrant) headers['x-collaby-share-grant'] = this.shareGrant;
      return fetch(absolute(path), { method: 'POST', headers, credentials: 'include', body });
    };

    let response = await send(this.accessToken);

    if (response.status === 401) {
      const token = await this.refresh();
      if (token) response = await send(token);
    }

    const text = await response.text();
    const payload = text.length > 0 ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        (payload as ApiError) ?? { error: 'upload_failed', message: response.statusText },
      );
    }

    return payload as T;
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiClient();

export function collabEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_COLLAB_URL;
  if (configured) return configured;

  if (API_URL) return `${API_URL.replace(/^http/, 'ws')}/collab`;

  if (typeof window === 'undefined') return 'ws://localhost:4000/collab';

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/collab`;
}
