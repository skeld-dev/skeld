import { type Counter, keyedCounter } from './counts.ts';
import { raise } from './events.ts';

export interface LimitState {
  readonly name: string;
  readonly nearCount: Counter;
  n: number;
  runN: number;
  used: number;
  max: number;
  ratio: number;
  near: number;
  over: number;
  runPeak: number;
  armed: boolean;
}

export interface LimitFigures {
  readonly n: number;
  readonly used: number;
  readonly max: number;
  readonly ratio: number;
  readonly near: number;
  readonly over: number;
  readonly run_peak: number;
  readonly armed: boolean;
}

const NEAR = 0.8;
const ALARM = 0.95;
const PREFIX = 'limit.';

const states = new Map<string, LimitState>();

export function limitState(name: string): LimitState {
  const found = states.get(name);
  if (found !== undefined) {
    return found;
  }
  const created: LimitState = {
    name,
    nearCount: keyedCounter('ingress.near_limit', name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name),
    n: 0,
    runN: 0,
    used: 0,
    max: 0,
    ratio: 0,
    near: 0,
    over: 0,
    runPeak: 0,
    armed: true,
  };
  states.set(name, created);
  return created;
}

export function observe(state: LimitState, used: number, max: number, route: string | null): void {
  const ratio = max > 0 ? used / max : 0;
  state.n += 1;
  state.runN += 1;
  if (state.n === 1 || ratio > state.ratio) {
    state.used = used;
    state.max = max;
    state.ratio = ratio;
  }
  if (ratio > state.runPeak) {
    state.runPeak = ratio;
  }
  if (ratio > 1) {
    state.over += 1;
  } else if (ratio >= NEAR) {
    state.near += 1;
    state.nearCount.total += 1;
  }
  if (state.armed && ratio >= ALARM) {
    state.armed = false;
    raise(state.name, 'headroom_low', route, null);
  } else if (!state.armed && ratio < NEAR) {
    state.armed = true;
  }
}

export function takeLimitFigures(): Record<string, LimitFigures> {
  const figures: Record<string, LimitFigures> = {};
  for (const state of states.values()) {
    if (state.runN > 0) {
      figures[state.name] = {
        n: state.n,
        used: state.used,
        max: state.max,
        ratio: Math.round(state.ratio * 1e6) / 1e6,
        near: state.near,
        over: state.over,
        run_peak: Math.round(state.runPeak * 1e6) / 1e6,
        armed: state.armed,
      };
    }
    state.n = 0;
    state.used = 0;
    state.max = 0;
    state.ratio = 0;
    state.near = 0;
    state.over = 0;
  }
  return figures;
}
