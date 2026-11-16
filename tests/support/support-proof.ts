// Does:  Gives the logging scripts a case reporter that prints to stdout, and a planted-marker search.
// Holds: Every case prints one pass or fail line, and the exit code is non-zero when any case failed.

import { randomBytes } from 'node:crypto';

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

const windowLength = 10;

export function createReport(): Report {
  let cases = 0;
  let failed = 0;
  const emit = (line: string): void => {
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
