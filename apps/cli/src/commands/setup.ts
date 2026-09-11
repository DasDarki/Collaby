import { hostname, platform, arch } from 'node:os';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openBrowser } from '../browser.js';
import { CollabyClient, HttpFailure, requestJson } from '../client.js';
import { CliError, EXIT_USAGE } from '../errors.js';
import { describe, pull } from '../sync.js';
import {
  initMeta,
  metaPath,
  readConfig,
  readCredentials,
  writeCredentials,
  type Credentials,
} from '../store.js';

interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
}

type TokenReply =
  | { status: 'pending' }
  | ({ status: 'approved'; user: Credentials['user'] } & Omit<Credentials, 'user'>);

function normalizeServer(input: string): string {
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new CliError(`"${input}" is not a valid address.`, EXIT_USAGE);
  }

  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

async function isEmptyOrMissing(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory);
    return entries.length === 0;
  } catch {
    return true;
  }
}

export async function setup(
  serverInput: string | undefined,
  directoryInput: string | undefined,
  options: { browser: boolean },
  log: (line: string) => void,
): Promise<void> {
  if (!serverInput) {
    throw new CliError('Tell me which Collaby to connect to: collaby setup <url>', EXIT_USAGE);
  }

  const server = normalizeServer(serverInput);
  const root = resolve(directoryInput ?? process.cwd());

  const existing = await readCredentials(root).catch(() => null);
  if (existing) {
    throw new CliError(
      `${root} is already connected as ${existing.user.email}. Run collaby logout there first.`,
    );
  }

  const hasMeta = await stat(metaPath(root, 'config.json')).then(
    () => true,
    () => false,
  );
  if (!hasMeta && !(await isEmptyOrMissing(root))) {
    log(`Syncing into ${root}, next to the files already there. Existing files are left alone.`);
  }

  let device: DeviceStart;
  try {
    device = (
      await requestJson<DeviceStart>(`${server}/api/cli/device`, {
        method: 'POST',
        body: {
          clientName: 'Collaby CLI',
          hostname: hostname(),
          platform: `${platform()} ${arch()}`,
        },
      })
    ).body;
  } catch (error) {
    if (error instanceof HttpFailure && error.status === 404) {
      throw new CliError(`${server} does not look like a Collaby server.`);
    }
    throw error;
  }

  log('');
  log('Open this page to connect the CLI:');
  log(`  ${device.verificationUriComplete}`);
  log('');
  log(`Your code: ${device.userCode}`);
  log('');

  if (options.browser && openBrowser(device.verificationUriComplete)) {
    log('Opened it in your browser. Waiting for you to approve...');
  } else {
    log('Waiting for you to approve...');
  }

  const deadline = Date.now() + device.expiresIn * 1000;
  let approved: Extract<TokenReply, { status: 'approved' }> | null = null;

  while (!approved) {
    if (Date.now() > deadline) throw new CliError('The code expired. Run collaby setup again.');

    let reply: TokenReply;
    try {
      reply = (
        await requestJson<TokenReply>(`${server}/api/cli/token`, {
          method: 'POST',
          body: { deviceCode: device.deviceCode },
        })
      ).body;
    } catch (error) {
      if (error instanceof HttpFailure) {
        if (error.code === 'access_denied')
          throw new CliError('The request was declined in the browser.');
        if (error.status === 410) throw new CliError(error.message);
      }
      throw error;
    }

    if (reply.status === 'approved') approved = reply;
  }

  const verification = new URL(device.verificationUri);
  await initMeta(root, {
    version: 1,
    server,
    webUrl: verification.origin,
    createdAt: new Date().toISOString(),
  });

  await writeCredentials(root, {
    accessToken: approved.accessToken,
    accessTokenExpiresAt: approved.accessTokenExpiresAt,
    refreshToken: approved.refreshToken,
    refreshTokenExpiresAt: approved.refreshTokenExpiresAt,
    sessionId: approved.sessionId,
    user: approved.user,
  });

  log(`Signed in as ${approved.user.email}. Downloading your pages...`);

  const client = await CollabyClient.open(root, await readConfig(root));
  const summary = await pull(root, client);

  for (const line of describe(summary)) log(line);
  log('');
  log(`Run collaby pull in ${root} for the latest version, or collaby watch to stay in sync.`);
}
