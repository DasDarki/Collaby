export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_SIGNED_OUT = 3;

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = EXIT_FAILURE) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export class SignedOutError extends CliError {
  constructor(message = 'This folder is signed out. Run collaby setup <url> to connect it again.') {
    super(message, EXIT_SIGNED_OUT);
    this.name = 'SignedOutError';
  }
}
