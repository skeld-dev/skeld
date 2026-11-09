interface EventState {
  readonly name: string;
  readonly failsRun: boolean;
  n: number;
  runN: number;
  suppressed: number;
  runSuppressed: number;
  lines: number;
}

export interface EventFigures {
  readonly n: number;
  readonly run_n: number;
  readonly suppressed: number;
  readonly run_suppressed: number;
}

// C-51: at most 10 journal lines per event name per one-second window.
const LINES_PER_WINDOW = 10;
const SUBJECT_LENGTH = 64;

const states = new Map<string, EventState>();
const journal: string[] = [];

function stateOf(name: string): EventState {
  const found = states.get(name);
  if (found !== undefined) {
    return found;
  }
  const created: EventState = {
    name,
    failsRun: name.startsWith('leak.') || name.startsWith('contain.'),
    n: 0,
    runN: 0,
    suppressed: 0,
    runSuppressed: 0,
    lines: 0,
  };
  states.set(name, created);
  return created;
}

export function raise(
  name: string,
  subject: string | number | null,
  route: string | null,
  status: number | null,
): void {
  const state = stateOf(name);
  state.n += 1;
  state.runN += 1;
  if (state.lines >= LINES_PER_WINDOW) {
    state.suppressed += 1;
    state.runSuppressed += 1;
    return;
  }
  state.lines += 1;
  journal.push(
    JSON.stringify({
      t: Date.now(),
      hook: name,
      route,
      status,
      subject: typeof subject === 'string' ? subject.slice(0, SUBJECT_LENGTH) : subject,
      fails_run: state.failsRun,
    }),
  );
}

export function takeJournal(): string[] {
  return journal.splice(0, journal.length);
}

export function takeEventFigures(): Record<string, EventFigures> {
  const figures: Record<string, EventFigures> = {};
  for (const state of states.values()) {
    if (state.runN > 0) {
      figures[state.name] = {
        n: state.n,
        run_n: state.runN,
        suppressed: state.suppressed,
        run_suppressed: state.runSuppressed,
      };
    }
    state.n = 0;
    state.suppressed = 0;
    state.lines = 0;
  }
  return figures;
}

export function failingNames(): string[] {
  const names: string[] = [];
  for (const state of states.values()) {
    if (state.failsRun && state.runN > 0) {
      names.push(state.name);
    }
  }
  return names;
}
