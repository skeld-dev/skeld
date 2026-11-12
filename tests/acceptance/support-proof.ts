// Does:  Gives the logging proof scripts a case reporter that keeps its evidence file, and a planted-marker search.
// Holds: The evidence file holds exactly the lines printed, and the exit code is non-zero when any case failed.

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Report {
  note: (line: string) => void;
  result: (name: string, problems: string[], detail: string) => void;
  finish: () => void;
}

export interface Marker {
  whole: string;
  windows: string[];
}

export interface Searched {
  where: string;
  text: string;
}

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const evidenceDir = join(sourceRoot, '.project/features/logging/evidence/gate');
const windowLength = 10;

export function createReport(script: string): Report {
  const lines: string[] = [];
  let cases = 0;
  let failed = 0;
  const emit = (line: string): void => {
    lines.push(line);
    process.stdout.write(`${line}\n`);
  };
  return {
    note: emit,
    result: (name, problems, detail) => {
      cases++;
      if (problems.length === 0) {
        emit(`pass ${name}: ${detail}`);
        return;
      }
      failed++;
      emit(`fail ${name}: ${problems.join('; ')}`);
    },
    finish: () => {
      emit(`${cases - failed} of ${cases} cases passed`);
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, `${script}.txt`), `${lines.join('\n')}\n`);
      process.exitCode = failed === 0 ? 0 : 1;
    },
  };
}

// Does:  Makes a planted string of a tag and 24 random hex digits, with every 10-digit cut of the digits.
export function newMarker(tag: string): Marker {
  const digits = randomBytes(12).toString('hex');
  const windows: string[] = [];
  for (let at = 0; at + windowLength <= digits.length; at++) {
    windows.push(digits.slice(at, at + windowLength));
  }
  return { whole: `MARK_${tag}_${digits}`, windows };
}

// Does:  Returns where a marker appears, whole or as any 10-digit cut of it, in the searched texts.
export function findMarker(marker: Marker, texts: readonly Searched[]): string[] {
  const found: string[] = [];
  for (const { where, text } of texts) {
    if (text.includes(marker.whole)) {
      found.push(`${where} holds ${marker.whole}`);
      continue;
    }
    const cut = marker.windows.find((window) => text.includes(window));
    if (cut !== undefined) {
      found.push(`${where} holds the cut ${cut} of ${marker.whole}`);
    }
  }
  return found;
}

export function check(problems: string[], condition: boolean, message: string): void {
  if (!condition) {
    problems.push(message);
  }
}
