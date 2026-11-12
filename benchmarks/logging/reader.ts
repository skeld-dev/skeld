// Does:  Reads stdin as a healthy, silent or exiting reader of a server's stdout and copies each byte read to a file.
// Holds: No byte is read from stdin before the silent window ends, and every byte read is in the file before exit.

import { closeSync, openSync, writeSync } from 'node:fs';

type Mode = 'read' | 'silent' | 'exit';

interface ReaderOptions {
  readonly mode: Mode;
  readonly ms: number | null;
  readonly out: string;
}

const modes: readonly Mode[] = ['read', 'silent', 'exit'];
const msRange = { min: 1, max: 600_000 } as const;
const wholeNumber = /^\d+$/;
const usageText =
  'usage: node benchmarks/logging/reader.ts --mode <read|silent|exit> [--ms <n>] --out <file>; silent and exit need --ms';

const fail = (exitCode: 1 | 2, message: string): never => {
  process.stderr.write(`error: ${message}\n`);
  process.exit(exitCode);
};

const parseMs = (text: string | undefined, mode: Mode): number | null => {
  if (mode === 'read') {
    return text === undefined ? null : fail(2, `--ms has no meaning in read mode. ${usageText}`);
  }
  const value = Number(text);
  if (text === undefined || !wholeNumber.test(text) || value < msRange.min || value > msRange.max) {
    return fail(2, `--ms must be a whole number from ${msRange.min} to ${msRange.max} in ${mode} mode.`);
  }
  return value;
};

const parseArguments = (argv: readonly string[]): ReaderOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? '';
    const value = argv[index + 1];
    if (!['--mode', '--ms', '--out'].includes(name) || value === undefined || values.has(name)) {
      return fail(2, usageText);
    }
    values.set(name, value);
  }
  const mode = modes.find((candidate) => candidate === values.get('--mode'));
  const out = values.get('--out');
  if (mode === undefined || out === undefined) {
    return fail(2, usageText);
  }
  return { mode, ms: parseMs(values.get('--ms'), mode), out };
};

const options = parseArguments(process.argv.slice(2));
const file = openSync(options.out, 'w');

const copy = (chunk: Buffer): void => {
  writeSync(file, chunk);
};

const finish = (): never => {
  closeSync(file);
  process.exit(0);
};

// Why: process.stdin is created on first access, so a silent reader leaves the pipe untouched until it reads.
const read = (): void => {
  const input = process.stdin;
  input.on('data', copy);
  input.once('end', finish);
  input.once('error', (error) => {
    closeSync(file);
    fail(1, `stdin failed: ${error.message}`);
  });
  if (options.mode === 'exit' && options.ms !== null) {
    setTimeout(() => {
      input.pause();
      input.off('data', copy);
      // Why: Bytes already taken from the pipe but not yet emitted are still in the stream's buffer.
      for (let chunk: unknown = input.read(); chunk !== null; chunk = input.read()) {
        if (Buffer.isBuffer(chunk)) {
          copy(chunk);
        }
      }
      finish();
    }, options.ms);
  }
};

if (options.mode === 'silent' && options.ms !== null) {
  setTimeout(read, options.ms);
} else {
  read();
}
