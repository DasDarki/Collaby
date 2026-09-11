import { CollabyClient, HttpFailure } from '../client.js';
import { CliError, SignedOutError } from '../errors.js';
import { describe, pull, type PullSummary } from '../sync.js';
import {
  deleteCredentials,
  readConfig,
  readCredentials,
  readState,
  requireRoot,
} from '../store.js';

interface Output {
  log: (line: string) => void;
  json: boolean;
  quiet: boolean;
}

export async function runPull(output: Output): Promise<PullSummary> {
  const root = await requireRoot(process.cwd());
  const client = await CollabyClient.open(root, await readConfig(root));
  const summary = await pull(root, client);

  if (output.json) output.log(JSON.stringify({ root, ...summary }));
  else if (!output.quiet) describe(summary).forEach(output.log);

  return summary;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function runWatch(output: Output): Promise<void> {
  const root = await requireRoot(process.cwd());
  const client = await CollabyClient.open(root, await readConfig(root));
  const controller = new AbortController();
  const stop = () => controller.abort();

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const stampLog = (line: string) => output.log(`[${new Date().toLocaleTimeString()}] ${line}`);

  let cursor = (await pull(root, client)).cursor;
  if (!output.quiet) stampLog(`Watching ${root}. Press Ctrl+C to stop.`);

  let backoff = 1_000;

  while (!controller.signal.aborted) {
    try {
      const result = await client.call<{ changed: boolean; cursor: string }>(
        `/api/cli/wait?cursor=${encodeURIComponent(cursor)}`,
        { signal: controller.signal },
      );

      backoff = 1_000;
      if (!result.changed) continue;

      const summary = await pull(root, client);
      cursor = summary.cursor;
      if (!output.quiet) describe(summary).forEach(stampLog);
    } catch (error) {
      if (controller.signal.aborted) break;
      if (error instanceof SignedOutError) throw error;

      const message = error instanceof Error ? error.message : String(error);
      if (!output.quiet) stampLog(`${message} Retrying in ${Math.round(backoff / 1000)}s.`);
      await sleep(backoff, controller.signal);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }

  if (!output.quiet) stampLog('Stopped watching.');
}

export async function runStatus(output: Output): Promise<void> {
  const root = await requireRoot(process.cwd());
  const config = await readConfig(root);
  const credentials = await readCredentials(root);
  const state = await readState(root);
  const localPages = Object.keys(state.files).length;

  let remote: { workspaces: string[]; documentCount: number; scope: { all: boolean } } | null =
    null;
  let signedIn = Boolean(credentials);

  if (credentials) {
    try {
      const client = new CollabyClient(root, config, credentials);
      remote = await client.call('/api/cli/whoami');
    } catch (error) {
      if (error instanceof SignedOutError) signedIn = false;
      else if (!(error instanceof HttpFailure)) throw error;
    }
  }

  const report = {
    root,
    server: config.server,
    signedIn,
    account: credentials?.user.email ?? null,
    access: remote ? (remote.scope.all ? 'all workspaces' : remote.workspaces.join(', ')) : null,
    remotePages: remote?.documentCount ?? null,
    localPages,
    lastPullAt: state.lastPullAt,
  };

  if (output.json) {
    output.log(JSON.stringify(report));
    return;
  }

  output.log(`Folder     ${report.root}`);
  output.log(`Server     ${report.server}`);
  output.log(`Account    ${report.account ?? 'signed out'}${signedIn ? '' : ' (signed out)'}`);
  if (report.access !== null) output.log(`Access     ${report.access || 'nothing'}`);
  output.log(
    `Pages      ${localPages} local${report.remotePages !== null ? `, ${report.remotePages} on the server` : ''}`,
  );
  output.log(
    `Last pull  ${report.lastPullAt ? new Date(report.lastPullAt).toLocaleString() : 'never'}`,
  );
}

export async function runLogout(output: Output): Promise<void> {
  const root = await requireRoot(process.cwd());
  const config = await readConfig(root);
  const credentials = await readCredentials(root);

  if (!credentials) throw new CliError('This folder is already signed out.');

  try {
    await new CollabyClient(root, config, credentials).call('/api/cli/logout', { method: 'POST' });
  } catch (error) {
    if (!(error instanceof SignedOutError) && !(error instanceof HttpFailure)) throw error;
  }

  await deleteCredentials(root);
  output.log(
    'Signed out. The synced files stay in place; delete the folder if you no longer need them.',
  );
}
