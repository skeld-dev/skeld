// Does:  Writes batches to fd 1 for every server of the process, one operation at a time, in the order turns are asked.
// Holds: At most one operation on fd 1 is active per process, kept until its last byte is written or it fails.

import { write } from 'node:fs';
import { RETRY_MS } from './limits.ts';

// Does:  One server's place in the turn list.
export interface WriterTurn {
  // Does:  Hands over this server's next batch as text when its turn comes, or null when nothing waits.
  take(): string | null;
  // Does:  Receives the end of the operation started from this turn's batch: every byte written, or failed.
  settled(ok: boolean): void;
}

const STDOUT = 1;

const waiting = new Set<WriterTurn>();
let active: WriterTurn | null = null;
let startedAt = 0;

// Does:  Adds a turn to the end of the list unless it waits already, and starts the next operation when none is active.
export function askTurn(turn: WriterTurn): void {
  waiting.add(turn);
  next();
}

// Does:  The age of the process's active operation in ms, whichever server owns it; 0 when none.
export function pendingMs(): number {
  return active === null ? 0 : performance.now() - startedAt;
}

function next(): void {
  for (const turn of waiting) {
    if (active !== null) {
      return;
    }
    waiting.delete(turn);
    const text = turn.take();
    if (text !== null) {
      active = turn;
      startedAt = performance.now();
      writeFrom(turn, Buffer.from(text), 0);
    }
  }
}

function finish(turn: WriterTurn, ok: boolean): void {
  active = null;
  turn.settled(ok);
  next();
}

// Does:  Writes the batch from offset on: a short write's remainder first, EAGAIN retried, any other errno fails it.
function writeFrom(turn: WriterTurn, data: Buffer, offset: number): void {
  write(STDOUT, data, offset, data.length - offset, null, (error, written) => {
    if (error === null) {
      if (offset + written < data.length) {
        writeFrom(turn, data, offset + written);
      } else {
        finish(turn, true);
      }
    } else if (error.code === 'EAGAIN') {
      // Why: Another process made the shared pipe non-blocking; the queue bounds memory, so the retry has no limit.
      setTimeout(writeFrom, RETRY_MS, turn, data, offset).unref();
    } else {
      finish(turn, false);
    }
  });
}
