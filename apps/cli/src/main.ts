import { CliError, EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './errors.js';
import { setup } from './commands/setup.js';
import { runLogout, runPull, runStatus, runWatch } from './commands/sync-commands.js';

declare const COLLABY_CLI_VERSION: string;

const HELP = `Collaby CLI ${COLLABY_CLI_VERSION}
Keeps a read-only copy of your Collaby pages in a local folder.

Usage
  collaby setup <url> [folder]   Connect a folder to a Collaby server and download it
  collaby pull                   Bring the folder up to date
  collaby watch                  Stay up to date until you press Ctrl+C
  collaby status                 Show the account, access and last sync
  collaby logout                 Sign this folder out on the server

Options
  --no-browser   Print the approval link instead of opening a browser
  --json         Machine readable output for pull and status
  --quiet        Only print errors
  --version      Print the version

pull, watch, status and logout work from any folder inside a synced folder.
Exit code 3 means the folder is signed out and needs collaby setup again.`;

function parse(argv: string[]) {
  const flags = new Set<string>();
  const positional: string[] = [];

  for (const argument of argv) {
    if (argument.startsWith('--')) flags.add(argument.slice(2));
    else if (argument === '-h') flags.add('help');
    else if (argument === '-v') flags.add('version');
    else positional.push(argument);
  }

  return { flags, command: positional[0], args: positional.slice(1) };
}

async function main(): Promise<number> {
  const { flags, command, args } = parse(process.argv.slice(2));

  if (flags.has('version')) {
    console.log(COLLABY_CLI_VERSION);
    return EXIT_OK;
  }

  if (!command || flags.has('help') || command === 'help') {
    console.log(HELP);
    return command || flags.has('help') ? EXIT_OK : EXIT_USAGE;
  }

  const quiet = flags.has('quiet');
  const json = flags.has('json');
  const log = (line: string) => {
    if (!quiet || json) console.log(line);
  };
  const output = { log, json, quiet };

  switch (command) {
    case 'setup':
      await setup(args[0], args[1], { browser: !flags.has('no-browser') }, (line) =>
        console.log(line),
      );
      return EXIT_OK;
    case 'pull':
      await runPull(output);
      return EXIT_OK;
    case 'watch':
      await runWatch(output);
      return EXIT_OK;
    case 'status':
      await runStatus(output);
      return EXIT_OK;
    case 'logout':
      await runLogout(output);
      return EXIT_OK;
    default:
      console.error(`Unknown command "${command}".\n`);
      console.error(HELP);
      return EXIT_USAGE;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof CliError) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(EXIT_FAILURE);
  },
);
