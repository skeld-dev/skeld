import { BootError } from '../../server/boot-error.ts';
import type { ResolvedServerOptions } from '../../server/types.ts';

interface RecorderConfig {
  stepN: number;
  cpuN: number;
  blockMs: number;
  canary: string | null;
  options: ResolvedServerOptions | null;
}

export interface DiagSettings {
  readonly dir: string;
  readonly stepN: number;
  readonly cpuN: number;
  readonly blockMs: number;
  readonly canary: string | null;
}

const WHOLE_NUMBER = /^[1-9][0-9]{0,8}$/;
const CANARY_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export const config: RecorderConfig = { stepN: 8, cpuN: 32, blockMs: 20, canary: null, options: null };

export const refuse = (message: string): BootError => new BootError('INVALID_OPTION', message, null, null);

function readWholeNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  if (!WHOLE_NUMBER.test(value)) {
    throw refuse(`${name} must be a whole number from 1 to 999999999; got ${value}`);
  }
  return Number(value);
}

function readCanary(): string | null {
  const value = process.env.DARKSTART_DIAG_CANARY;
  if (value === undefined) {
    return null;
  }
  if (!CANARY_TOKEN.test(value)) {
    throw refuse(
      `DARKSTART_DIAG_CANARY must be 16 to 128 characters of A-Z, a-z, 0-9, _ and -; got ${value.length} characters`,
    );
  }
  return value;
}

export function readSettings(): DiagSettings {
  const dir = process.env.DARKSTART_DIAG_DIR;
  if (dir === undefined || dir === '') {
    throw refuse(
      'DARKSTART_DIAG_DIR is not set; the diag build writes run.json, snapshot.jsonl and journal.jsonl into it',
    );
  }
  return {
    dir,
    stepN: readWholeNumber('DARKSTART_DIAG_STEP_N', 8),
    cpuN: readWholeNumber('DARKSTART_DIAG_CPU_N', 32),
    blockMs: readWholeNumber('DARKSTART_DIAG_BLOCK_MS', 20),
    canary: readCanary(),
  };
}
