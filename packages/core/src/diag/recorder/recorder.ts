// Does:  Implements every diagnostic hook for the diag build and owns the run's start and end.
// Holds: It exports exactly the hooks empty.ts declares, with the same signatures.

import type { ResolvedServerOptions } from '../../server/types.ts';
import type {
  Begin,
  Closed,
  Contain,
  Count,
  Current,
  Declare,
  Destroyed,
  End,
  Event,
  Header,
  Key,
  Leave,
  Limit,
  Listening,
  Mark,
  Next,
  Open,
  Payload,
  Resume,
  Routed,
  Start,
  Stderr,
  Track,
  Wrote,
} from '../empty.ts';
import { nowNs, toMillis } from './clock.ts';
import { config, readSettings } from './config.ts';
import { checkContain, watchServer } from './contain.ts';
import { keyedCounter } from './counts.ts';
import { checkHeader, checkKey, checkPayload, checkStderr, declareRoute } from './egress.ts';
import { raise } from './events.ts';
import { claimFolder, writeRunFile } from './files.ts';
import { finishDestroyed, finishWrote } from './finish.ts';
import { unwatchFloor, watchFloor } from './floor.ts';
import { closeBoot, markBoot, openBoot } from './ledger.ts';
import { limitState, observe } from './limits.ts';
import { startProcessWatch, stopProcessWatch } from './process.ts';
import { runHeader } from './run.ts';
import { bootFigures, writeSnapshot } from './snapshot.ts';
import { beginRequest, currentRouteId, currentSlot, leaveSlot, resumeSlot, routeRequest, state } from './slots.ts';
import { endSpan, nextSpan, startSpan, trackSpan } from './spans.ts';

export type { Slot, Token } from '../empty.ts';

export const RECORDER_MARKER = 'darkstart:diag-recorder';

interface RunState {
  status: 'booting' | 'listening' | 'closed';
  options: ResolvedServerOptions | null;
  openNs: number;
  listeningAt: number | null;
  closedAt: number | null;
  address: unknown;
  timer: NodeJS.Timeout | null;
  finalWritten: boolean;
}

const SNAPSHOT_INTERVAL_MS = 1000;

const run: RunState = {
  status: 'booting',
  options: null,
  openNs: 0,
  listeningAt: null,
  closedAt: null,
  address: null,
  timer: null,
  finalWritten: false,
};

function runFile(options: ResolvedServerOptions): string {
  return runHeader({
    marker: RECORDER_MARKER,
    status: run.status,
    startedAt: bootFigures.startedAt,
    listeningAt: run.listeningAt,
    closedAt: run.closedAt,
    address: run.address,
    readyMs: bootFigures.readyMs,
    stepN: config.stepN,
    cpuN: config.cpuN,
    blockMs: config.blockMs,
    canary: config.canary !== null,
    options,
  });
}

function writeFinal(): void {
  if (!run.finalWritten) {
    run.finalWritten = true;
    writeSnapshot(true);
  }
}

export const begin: Begin = beginRequest;
export const leave: Leave = leaveSlot;
export const resume: Resume = resumeSlot;
export const current: Current = currentSlot;
export const routed: Routed = routeRequest;
export const start: Start = startSpan;
export const end: End = endSpan;
export const next: Next = nextSpan;
export const track: Track = trackSpan;

export const count: Count = (name, countKey) => {
  keyedCounter(name, countKey).total += 1;
};

export const event: Event = (name, subject) => {
  raise(name, subject ?? null, currentRouteId(), null);
};

export const limit: Limit = (name, used, max) => {
  observe(limitState(name), used, max, currentRouteId());
};

export const wrote: Wrote = finishWrote;
export const destroyed: Destroyed = finishDestroyed;
export const header: Header = checkHeader;
export const contain: Contain = checkContain;
export const payload: Payload = checkPayload;
export const key: Key = checkKey;
export const stderr: Stderr = checkStderr;

export const open: Open = (options) => {
  const settings = readSettings();
  config.stepN = settings.stepN;
  config.cpuN = settings.cpuN;
  config.blockMs = settings.blockMs;
  config.canary = settings.canary;
  config.options = options;
  run.options = options;
  run.openNs = nowNs();
  bootFigures.startedAt = Date.now();
  claimFolder(settings.dir, runFile(options));
  // Why: A process that exits without close() still gets its final snapshot.
  process.on('exit', writeFinal);
  openBoot();
};

export const declare: Declare = declareRoute;

export const listening: Listening = (server) => {
  closeBoot();
  state.listening = true;
  run.status = 'listening';
  run.listeningAt = Date.now();
  run.address = server.address();
  bootFigures.readyMs = toMillis(nowNs() - run.openNs);
  watchFloor(server);
  watchServer(server);
  startProcessWatch();
  run.timer = setInterval(() => writeSnapshot(false), SNAPSHOT_INTERVAL_MS);
  // Why: The snapshot timer must not keep the process alive.
  run.timer.unref();
  if (run.options !== null) {
    writeRunFile(runFile(run.options));
  }
};

export const mark: Mark = markBoot;

export const closed: Closed = () => {
  if (run.timer !== null) {
    clearInterval(run.timer);
    run.timer = null;
  }
  writeFinal();
  process.off('exit', writeFinal);
  unwatchFloor();
  watchServer(null);
  stopProcessWatch();
  run.status = 'closed';
  run.closedAt = Date.now();
  if (run.options !== null) {
    writeRunFile(runFile(run.options));
  }
};
