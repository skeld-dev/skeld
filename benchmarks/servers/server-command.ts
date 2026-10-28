import { host, standalonePort } from '../values.ts';

const portPattern = /^\d+$/;
const maxPort = 65_535;

const fail = (exitCode: number, message: string): never => {
  process.stderr.write(`error: ${message}\n`);
  process.exit(exitCode);
};

const parsePortValue = (text: string): number => {
  const port = Number(text);
  if (!portPattern.test(text) || port > maxPort) {
    return fail(2, `--port must be a whole number from 0 to ${maxPort}, got "${text}".`);
  }
  return port;
};

export function parsePort(argv: readonly string[]): number {
  let port = standalonePort;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    if (token === '--port') {
      port = parsePortValue(argv[index + 1] ?? '');
      index++;
    } else if (token.startsWith('--port=')) {
      port = parsePortValue(token.slice('--port='.length));
    } else {
      fail(2, `unknown option ${token}. The only option is --port <n>.`);
    }
  }
  return port;
}

export function announceReady(server: string, port: number): void {
  process.stdout.write(`${JSON.stringify({ server, port })}\n`);
}

const listenErrorCode = (error: unknown): string | null =>
  error instanceof Error &&
  'syscall' in error &&
  error.syscall === 'listen' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null;

export function failToStart(server: string, port: number, error: unknown): never {
  const code = listenErrorCode(error);
  if (code !== null) {
    return fail(1, `cannot listen on ${host}:${port}: ${code}.`);
  }
  return fail(1, `${server} did not start: ${error instanceof Error ? error.message : String(error)}`);
}
