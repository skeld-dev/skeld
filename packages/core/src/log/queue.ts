// Does:  Holds one server's records from enqueue until a write or sink call settles them, under the cap and reserve.
// Holds: Every record is in exactly one of queued, in flight, written or dropped, so created is always their sum.

import { count } from '#diag';
import { SEVERITY_NUMBER } from './events.ts';
import { BATCH_BYTES, QUEUE_BYTES, RESERVE_BYTES } from './limits.ts';
import type { QueueCounts } from './shapes.ts';
import type { DropReason } from './types.ts';

export interface Queue {
  // Does:  Counts the record as created, then queues it or drops it under one reason; false when dropped.
  enqueue(line: string, severityNumber: number): boolean;
  // Does:  Moves the oldest whole lines, at most BATCH_BYTES with their newlines, to in flight; null when none waits.
  // Holds: Called only when nothing is in flight, so in flight is always one batch.
  take(): string[] | null;
  // Does:  Moves the batch in flight to written, or with a failure to dropped under that reason, once and whole.
  settle(failure: 'write_failed' | 'sink_failed' | null): void;
  // Does:  Arms the flush trigger when records wait and it is not armed already.
  schedule(): void;
  // Does:  Makes every later record a shutdown drop; queued records still wait for the flush.
  close(): void;
  // Does:  Drops every queued record as shutdown at the flush deadline; the batch in flight is left to settle.
  dropQueued(): void;
  queued(): number;
  idle(): boolean;
  counts(pendingMs: number): QueueCounts;
}

const WARN = SEVERITY_NUMBER.warn;
// Why: Batches a burst into one fs.write; the 2026-11-12 spike could not rank delays: provisional until the perf pass.
const FLUSH_MS = 5;

// Does:  Builds a server's queue; flush runs from the trigger's own task, onRecovered at a success after drops.
export function createQueue(flush: () => void, onRecovered: () => void): Queue {
  const lines: string[] = [];
  const sizes: number[] = [];
  const dropped: { [R in DropReason]: number } = {
    queue_full: 0,
    reserve: 0,
    write_failed: 0,
    sink_failed: 0,
    shutdown: 0,
  };
  let queuedBytes = 0;
  let inFlight = 0;
  let inFlightBytes = 0;
  let created = 0;
  let written = 0;
  let closed = false;
  let armed = false;
  let lost = false;

  function drop(reason: DropReason, records: number): void {
    dropped[reason] += records;
    lost = true;
    for (let index = 0; index < records; index++) {
      count('log.dropped', reason);
    }
  }

  function fire(): void {
    armed = false;
    flush();
  }

  function schedule(): void {
    if (armed || lines.length === 0) {
      return;
    }
    armed = true;
    // Why: An unreferenced trigger never keeps a finished process alive; a waiting close() holds the loop instead.
    setTimeout(fire, FLUSH_MS).unref();
  }

  return {
    enqueue(line, severityNumber) {
      created += 1;
      if (closed) {
        drop('shutdown', 1);
        return false;
      }
      const held = queuedBytes + inFlightBytes;
      if (severityNumber < WARN && held >= RESERVE_BYTES) {
        drop('reserve', 1);
        return false;
      }
      const size = Buffer.byteLength(line) + 1;
      if (held + size > QUEUE_BYTES) {
        drop('queue_full', 1);
        return false;
      }
      lines.push(line);
      sizes.push(size);
      queuedBytes += size;
      schedule();
      return true;
    },
    take() {
      if (lines.length === 0) {
        return null;
      }
      let bytes = 0;
      let taken = 0;
      // Why: A line holds at most RECORD_BYTES plus its newline, below BATCH_BYTES, so the first line always fits.
      for (const size of sizes) {
        if (bytes + size > BATCH_BYTES) {
          break;
        }
        bytes += size;
        taken += 1;
      }
      sizes.splice(0, taken);
      queuedBytes -= bytes;
      inFlight = taken;
      inFlightBytes = bytes;
      return lines.splice(0, taken);
    },
    settle(failure) {
      const records = inFlight;
      inFlight = 0;
      inFlightBytes = 0;
      if (failure !== null) {
        drop(failure, records);
        return;
      }
      written += records;
      if (lost) {
        lost = false;
        onRecovered();
      }
    },
    schedule,
    close() {
      closed = true;
    },
    dropQueued() {
      drop('shutdown', lines.length);
      lines.length = 0;
      sizes.length = 0;
      queuedBytes = 0;
    },
    queued: () => lines.length,
    idle: () => lines.length === 0 && inFlight === 0,
    counts(pendingMs) {
      return {
        created,
        written,
        queued: lines.length,
        queuedBytes,
        inFlight,
        inFlightBytes,
        pendingMs,
        dropped: { ...dropped },
      };
    },
  };
}
