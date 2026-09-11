import { CliError, SignedOutError } from './errors.js';
import {
  readCredentials,
  withLock,
  writeCredentials,
  type Config,
  type Credentials,
} from './store.js';

const REFRESH_MARGIN_MS = 60_000;

interface ErrorBody {
  message?: string;
  error?: string;
}

export class HttpFailure extends CliError {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, body: ErrorBody | null) {
    super(body?.message ?? `The server answered with status ${status}.`);
    this.status = status;
    this.code = body?.error;
  }
}

export async function requestJson<T>(
  url: string,
  init: {
    method?: string;
    body?: unknown;
    token?: string | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new CliError(
      `Could not reach ${new URL(url).origin}. Check the address and your connection.`,
    );
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) throw new HttpFailure(response.status, parsed as ErrorBody | null);
  return { status: response.status, body: parsed as T };
}

export class CollabyClient {
  private credentials: Credentials;

  constructor(
    private readonly root: string,
    private readonly config: Config,
    credentials: Credentials,
  ) {
    this.credentials = credentials;
  }

  static async open(root: string, config: Config): Promise<CollabyClient> {
    const credentials = await readCredentials(root);
    if (!credentials) throw new SignedOutError();
    return new CollabyClient(root, config, credentials);
  }

  get user(): Credentials['user'] {
    return this.credentials.user;
  }

  private expiresSoon(): boolean {
    return (
      new Date(this.credentials.accessTokenExpiresAt).getTime() - Date.now() < REFRESH_MARGIN_MS
    );
  }

  private async refresh(): Promise<void> {
    await withLock(this.root, 'refresh', async () => {
      const onDisk = await readCredentials(this.root);
      if (!onDisk) throw new SignedOutError();

      if (onDisk.refreshToken !== this.credentials.refreshToken) {
        this.credentials = onDisk;
        if (!this.expiresSoon()) return;
      }

      try {
        const { body } = await requestJson<Omit<Credentials, 'user'>>(
          `${this.config.server}/api/cli/refresh`,
          { method: 'POST', body: { refreshToken: this.credentials.refreshToken } },
        );

        this.credentials = { ...body, user: this.credentials.user };
        await writeCredentials(this.root, this.credentials);
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 401) {
          throw new SignedOutError(`${error.message}`);
        }
        throw error;
      }
    });
  }

  async call<T>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (this.expiresSoon()) await this.refresh();

    try {
      return (
        await requestJson<T>(`${this.config.server}${path}`, {
          ...init,
          token: this.credentials.accessToken,
        })
      ).body;
    } catch (error) {
      if (!(error instanceof HttpFailure) || error.status !== 401) throw error;

      await this.refresh();

      try {
        return (
          await requestJson<T>(`${this.config.server}${path}`, {
            ...init,
            token: this.credentials.accessToken,
          })
        ).body;
      } catch (retry) {
        if (retry instanceof HttpFailure && retry.status === 401)
          throw new SignedOutError(retry.message);
        throw retry;
      }
    }
  }
}
