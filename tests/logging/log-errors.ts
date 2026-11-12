// Does:  Proves the error reader on a running server: hostile values thrown from handlers and passed as fields.
// Holds: Each planted marker is searched whole and cut in stdout and stderr; every call count is the served module's.

// biome-ignore-all lint/security/noSecrets: planted markers and fixture names, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: each fixture is requested alone so its counts and records stay its own
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { defineContract } from '@skeld/core/contract';
import type { Logger } from '@skeld/core/log';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogChild, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport, findMarker, type Marker, newMarker, type Searched } from '../support/support-proof.ts';

type SetName = 'none' | 'ids' | 'text' | 'frames' | 'all';
type Val = string | null | { oneOf: readonly (string | null)[] };
type Formatter = (error: Error, sites: readonly unknown[]) => unknown;

const sets: Record<SetName, { errorIdentifiers: boolean; errorText: boolean; errorFrames: boolean }> = {
  none: { errorIdentifiers: false, errorText: false, errorFrames: false },
  ids: { errorIdentifiers: true, errorText: false, errorFrames: false },
  text: { errorIdentifiers: false, errorText: true, errorFrames: false },
  frames: { errorIdentifiers: false, errorText: false, errorFrames: true },
  all: { errorIdentifiers: true, errorText: true, errorFrames: true },
};
const all5: readonly SetName[] = ['none', 'ids', 'text', 'frames', 'all'];
const framesSets: readonly SetName[] = ['frames', 'all'];
const hasFrames = (set: SetName): boolean => set === 'frames' || set === 'all';
const hasIds = (set: SetName): boolean => set === 'ids' || set === 'all';
const hasText = (set: SetName): boolean => set === 'text' || set === 'all';

const plantNames = ['mark', 'hot', 'm1', 'm2', 'm3'] as const;
type PlantName = (typeof plantNames)[number] | 'big' | 'num';

interface Plants {
  mark: string;
  hot: string;
  m1: string;
  m2: string;
  m3: string;
  big: string;
  num: number;
}

interface Env {
  plant: Plants;
  set: SetName;
  count: (key: string) => () => void;
  formatter: (replacement: Formatter) => void;
  stackLimit: (limit: number) => void;
  log: Logger;
  cwd: string;
}

interface Want {
  kind?: Val;
  type?: Val;
  code?: Val;
  message?: Val;
  cause?: Val;
  frames?: Val | 'lines';
  counts?: Record<string, number>;
  absent?: readonly PlantName[];
  absentWhole?: readonly string[];
  framesAbsent?: readonly (PlantName | string)[];
  frameCount?: number;
  maxJson?: number;
  nested?: boolean;
}

interface Fixture {
  id: string;
  ac: string;
  name: string;
  sets: readonly SetName[];
  field: boolean;
  absent: readonly PlantName[];
  build: (env: Env) => unknown;
  want: (set: SetName) => Want;
}

const oneOf = (...values: (string | null)[]): Val => ({ oneOf: values });
const ERR = (type: Val, code: Val = null): Want => ({
  kind: 'error',
  type,
  code,
  message: null,
  cause: null,
  frames: null,
});
const NON: Want = { kind: 'non_error', type: null, code: null, message: null, cause: null, frames: null };
const FALLBACK: Want = {
  kind: oneOf('non_error', 'unreadable'),
  type: null,
  code: null,
  message: null,
  cause: null,
  frames: null,
};
const GENERIC = '_OTHER';

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the fixtures pass values a log call's types refuse, to see the run-time answer
  return value as never;
}

const laters = new WeakSet<object>();

// Does:  Marks a promise the handler must await; any other built value is never awaited, so no hostile `then` runs.
function later(pending: Promise<unknown>): object {
  const wrapper = { pending };
  laters.add(wrapper);
  return wrapper;
}

// Why: The value travels in a holder, because resolving a promise with a hostile value would read its `then`.
async function resolveBuilt(built: unknown): Promise<{ value: unknown }> {
  if (typeof built === 'object' && built !== null && laters.has(built)) {
    return { value: await Reflect.get(built, 'pending') };
  }
  return { value: built };
}

function readX(holder: Record<string, { x: number }>, key: string): number {
  return Reflect.get(holder, key).x;
}

function caught(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  throw new Error('the fixture did not throw');
}

function foreignRealm(source: string): unknown {
  return runInNewContext(source);
}

function spy(hit: () => void, target: object): object {
  const handler = new Proxy(
    {},
    {
      get(_, trap) {
        return (...args: unknown[]) => {
          hit();
          return Reflect.apply(Reflect.get(Reflect, trap), Reflect, args);
        };
      },
    },
  );
  return new Proxy(target, handler);
}

function throwingProxy(hit: () => void, target: object, hot: string): object {
  const handler = new Proxy(
    {},
    {
      get() {
        return () => {
          hit();
          throw new Error(hot);
        };
      },
    },
  );
  return new Proxy(target, handler);
}

function chain(depth: number, end: object): object {
  let proto = end;
  for (let step = 0; step < depth; step++) {
    proto = Object.create(proto);
  }
  return proto;
}

function deepCall<T>(depth: number, make: () => T): T {
  return depth === 0 ? make() : deepCall(depth - 1, make);
}

function frameText(plant: Plants): string {
  return `Error: m\n    at planted (/x/${plant.hot}.js:1:1)`;
}

function deferring(hit: () => void): Formatter {
  return (error, sites) => {
    hit();
    return [Error.prototype.toString.call(error), ...sites.map((site) => `    at ${String(site)}`)].join('\n');
  };
}

function defineGetter(target: object, key: string, hit: () => void, hot: string): void {
  Object.defineProperty(target, key, {
    get() {
      hit();
      return hot;
    },
    configurable: true,
  });
}

const fixtures: Fixture[] = [];
function add(
  id: string,
  ac: string,
  name: string,
  setList: readonly SetName[],
  field: boolean,
  absent: readonly PlantName[],
  build: (env: Env) => unknown,
  want: (set: SetName) => Want,
): void {
  fixtures.push({ id, ac, name, sets: setList, field, absent, build, want });
}
const none: readonly SetName[] = ['none'];

const plainCases: readonly (readonly [string, string, (env: Env) => unknown, Want])[] = [
  ['1', 'Error, marker message', ({ plant }) => new Error(`plain ${plant.mark}`), ERR('Error')],
  [
    '2',
    'Error, 3-line message, line 2 a fake frame',
    ({ plant }) => new Error(`line one\n    at fake (/x/${plant.mark}.js:1:1)\nline three`),
    ERR('Error'),
  ],
  [
    '3',
    'Error, message reassigned',
    ({ plant }) => Object.assign(new Error(`original ${plant.mark}`), { message: `reassigned ${plant.mark}` }),
    ERR('Error'),
  ],
  [
    '4',
    'Error, name reassigned to a marker',
    ({ plant }) => Object.assign(new Error(`named ${plant.mark}`), { name: `Renamed${plant.mark}` }),
    ERR('Error'),
  ],
  [
    '5',
    'class ValidationFailure extends Error',
    ({ plant }) => new (class ValidationFailure extends Error {})(`subclass ${plant.mark}`),
    ERR('Error'),
  ],
  [
    '6',
    'Error with a cause chain three deep',
    ({ plant }) =>
      new Error(`top ${plant.mark}`, {
        cause: new Error(`cause1 ${plant.mark}`, {
          cause: new Error(`cause2 ${plant.mark}`, { cause: new Error(`cause3 ${plant.mark}`) }),
        }),
      }),
    ERR('Error'),
  ],
  [
    '7',
    "two Errors each the other's cause",
    ({ plant }) => {
      const first = new Error(`a ${plant.mark}`);
      const second = new Error(`b ${plant.mark}`, { cause: first });
      first.cause = second;
      return first;
    },
    ERR('Error'),
  ],
  [
    '8',
    'AggregateError of two Errors',
    ({ plant }) =>
      new AggregateError([new Error(`agg1 ${plant.mark}`), new Error(`agg2 ${plant.mark}`)], `aggregate ${plant.mark}`),
    ERR('AggregateError'),
  ],
  [
    '9',
    'Error with own userId and token properties',
    ({ plant }) => Object.assign(new Error(`props ${plant.mark}`), { userId: 42, token: plant.mark }),
    ERR('Error'),
  ],
  [
    '11a',
    'JSON.parse of a short text with a trailing comma',
    ({ plant }) => caught(() => JSON.parse(`{"password":"${plant.mark}",}`)),
    ERR('SyntaxError'),
  ],
  [
    '11b',
    'JSON.parse of 10 KiB, marker at the start, fault at the end',
    ({ plant }) => caught(() => JSON.parse(`{"password":"${plant.mark}","pad":"${'x'.repeat(10 * 1024)}",}`)),
    ERR('SyntaxError'),
  ],
  [
    '12',
    'new URL with a marker in its credentials',
    ({ plant }) => caught(() => new URL(`http://user:${plant.mark}@[bad`)),
    ERR('TypeError'),
  ],
  [
    '14',
    'structuredClone of a function',
    ({ plant }) => caught(() => structuredClone(() => plant.mark)),
    {
      kind: oneOf('error', 'non_error'),
      type: oneOf('DOMException', null),
      code: null,
      message: null,
      cause: null,
      frames: null,
    },
  ],
  [
    '15',
    'assert.strictEqual of a marker',
    ({ plant }) => caught(() => assert.strictEqual(plant.mark, 'other')),
    ERR('Error'),
  ],
  [
    '16a',
    'property read of null keyed by a marker',
    ({ plant }) => caught(() => readX(pastTypes(Object.fromEntries([[plant.mark, null]])), plant.mark)),
    ERR('TypeError'),
  ],
  [
    '16b',
    'call of a missing method named by a marker',
    ({ plant }) => caught(() => Reflect.get({}, plant.mark)()),
    ERR('TypeError'),
  ],
  ['17', 'Error from another vm realm', ({ plant }) => foreignRealm(`new Error("${plant.mark}")`), ERR(GENERIC)],
  [
    '20a',
    'Error with a 1 MiB message',
    ({ plant }) => new Error(plant.mark + 'x'.repeat(1024 * 1024 - plant.mark.length)),
    { ...ERR('Error'), maxJson: 1000 },
  ],
  [
    '20b',
    'RangeError from unbounded recursion',
    () => {
      const recurse = (): number => recurse() + 1;
      return caught(recurse);
    },
    ERR('RangeError'),
  ],
  ['RE', 'a thrown RangeError', () => new RangeError('range'), ERR('RangeError')],
  ['19d', 'frozen Error', ({ plant }) => Object.freeze(new Error(`frozen ${plant.mark}`)), ERR('Error')],
];
for (const [id, name, build, want] of plainCases) {
  add(`7-${id}`, 'AC-7', name, none, true, ['mark'], build, () => want);
}

add(
  '7-10',
  'AC-7',
  'failed read of a missing file whose path holds a marker',
  none,
  true,
  ['mark'],
  ({ plant }) => caught(() => readFileSync(`/nonexistent/${plant.mark}.txt`)),
  () => ERR('Error', 'ENOENT'),
);
add(
  '7-13',
  'AC-7',
  'rejected fetch to 127.0.0.1:1 with a marker in the path',
  none,
  true,
  ['mark'],
  ({ plant }) =>
    later(
      (async () => {
        try {
          await fetch(`http://127.0.0.1:1/${plant.mark}`);
        } catch (error) {
          return error;
        }
        throw new Error('the fetch did not reject');
      })(),
    ),
  () => ERR('TypeError'),
);

for (const [id, name, make] of [
  ['18a', "throw 'string marker'", (p: Plants) => `string ${p.mark}`],
  ['18b', 'throw 42', () => 42],
  ['18c', 'throw null', () => null],
  ['18d', 'throw undefined', () => undefined],
  ['18e', 'throw Symbol(marker)', (p: Plants) => Symbol(p.mark)],
] as const) {
  add(
    `7-${id}`,
    'AC-7',
    name,
    none,
    false,
    ['mark'],
    ({ plant }) => make(plant),
    () => NON,
  );
}
add(
  '7-18f',
  'AC-7',
  "throw { code: 'E', message: marker }",
  none,
  true,
  ['mark'],
  ({ plant }) => ({ code: 'E', message: plant.mark }),
  () => NON,
);

add(
  '7-19a',
  'AC-7',
  'plain object whose message getter throws',
  all5,
  true,
  ['hot'],
  ({ plant, count }) => {
    const hit = count('messageGetter');
    return {
      get message() {
        hit();
        throw new Error(plant.hot);
      },
    };
  },
  () => NON,
);
add(
  '7-19a2',
  'AC-7',
  'plain object with counting name getter, toString, toJSON and constructor getter',
  all5,
  true,
  ['hot'],
  ({ plant, count }) => {
    const nameHit = count('nameGetter');
    const stringHit = count('stringified');
    const jsonHit = count('toJSON');
    const ctorHit = count('ctorGetter');
    return {
      get name() {
        nameHit();
        return plant.hot;
      },
      toString() {
        stringHit();
        return plant.hot;
      },
      toJSON() {
        jsonHit();
        return plant.hot;
      },
      get constructor() {
        ctorHit();
        return plant.hot;
      },
    };
  },
  () => NON,
);
const stackWant = (set: SetName): Want => ({
  kind: 'error',
  ...(set === 'none' || set === 'frames' ? { type: 'Error', code: null } : {}),
  ...(hasFrames(set) ? { frames: null } : {}),
});
add(
  '7-19b',
  'AC-7 AC-19',
  'Error whose own stack is a throwing, counting accessor',
  all5,
  true,
  ['hot'],
  ({ plant, count }) => {
    const hit = count('stackAccessor');
    const error = new Error('hostile stack');
    Object.defineProperty(error, 'stack', {
      get() {
        hit();
        throw new Error(plant.hot);
      },
      configurable: true,
    });
    return error;
  },
  stackWant,
);
add(
  '7-19b2',
  'AC-7 AC-19',
  'Error whose own stack is a counting accessor returning planted frame text',
  all5,
  true,
  ['hot'],
  ({ plant, count }) => {
    const hit = count('stackAccessor');
    const error = new Error('hostile stack');
    Object.defineProperty(error, 'stack', {
      get() {
        hit();
        return `Error: hostile stack\n    at planted (/x/${plant.hot}.js:1:1)`;
      },
      configurable: true,
    });
    return error;
  },
  (set) => ({ kind: 'error', ...(hasFrames(set) ? { frames: null } : {}) }),
);
add(
  '7-19c',
  'AC-7',
  'Proxy of an Error whose every trap counts and throws',
  all5,
  true,
  ['hot'],
  ({ plant, count }) => throwingProxy(count('trap'), new Error('proxied'), plant.hot),
  () => FALLBACK,
);
add(
  '7-19c2',
  'AC-7',
  'Proxy of an Error with counting pass-through traps',
  all5,
  true,
  ['mark'],
  ({ plant, count }) => spy(count('trap'), new Error(`proxied ${plant.mark}`)),
  () => FALLBACK,
);

const plants: readonly (readonly [string, (plant: Plants) => unknown, readonly PlantName[]])[] = [
  ['marker', (plant) => plant.mark, ['mark']],
  ['129-character string', (plant) => plant.big, ['mark']],
  ['number', (plant) => plant.num, ['mark', 'num']],
];
for (const [label, make, absent] of plants) {
  add(
    `7-name-${label.replaceAll(' ', '-')}`,
    'AC-7',
    `thrown value whose name is a ${label}`,
    none,
    true,
    absent,
    ({ plant }) => Object.assign(new Error('m'), { name: make(plant) }),
    () => ERR('Error'),
  );
  add(
    `7-code-${label.replaceAll(' ', '-')}`,
    'AC-7',
    `thrown value whose code is a ${label}`,
    none,
    true,
    absent,
    ({ plant }) => Object.assign(new Error('m'), { code: make(plant) }),
    () => ERR('Error'),
  );
}
add(
  '7-name-object',
  'AC-7',
  'thrown value whose name is an object with a counting toString',
  none,
  true,
  ['mark'],
  ({ plant, count }) => {
    const hit = count('stringified');
    return Object.assign(new Error('m'), {
      name: {
        toString() {
          hit();
          return plant.mark;
        },
        valueOf() {
          hit();
          return plant.mark;
        },
      },
    });
  },
  () => ERR('Error'),
);
add(
  '7-code-object',
  'AC-7',
  'thrown value whose code is an object with a counting toString',
  none,
  true,
  ['mark'],
  ({ plant, count }) => {
    const hit = count('stringified');
    return Object.assign(new Error('m'), {
      code: {
        toString() {
          hit();
          return plant.mark;
        },
        valueOf() {
          hit();
          return plant.mark;
        },
      },
    });
  },
  () => ERR('Error'),
);
add(
  '7-name-code-129-frames',
  'AC-7',
  'name and code are 129-character strings, with errorFrames alone',
  ['frames'],
  true,
  ['mark'],
  ({ plant }) => Object.assign(new Error('m'), { name: plant.big, code: plant.big }),
  () => ({ kind: 'error', type: 'Error', code: null }),
);
add(
  '7-class-marker',
  'AC-7',
  'class named by the marker extending RangeError',
  none,
  true,
  ['mark'],
  ({ plant }) => {
    const Named = { [plant.mark]: class extends RangeError {} }[plant.mark];
    assert(Named !== undefined);
    return new Named('m');
  },
  () => ERR('RangeError'),
);
add(
  '7-code-ERR-prefix',
  'AC-7',
  'RangeError subclass with code ERR_ and the marker',
  none,
  true,
  ['mark'],
  ({ plant }) => Object.assign(new (class extends RangeError {})('m'), { code: `ERR_${plant.mark}` }),
  () => ERR('RangeError'),
);
add(
  '7-class-and-code',
  'AC-7',
  'class named by the marker extending RangeError with code ERR_ and the marker',
  none,
  true,
  ['mark'],
  ({ plant }) => {
    const Named = { [plant.mark]: class extends RangeError {} }[plant.mark];
    assert(Named !== undefined);
    return Object.assign(new Named('m'), { code: `ERR_${plant.mark}` });
  },
  () => ERR('RangeError'),
);

const generic = (set: SetName): Want => ({
  kind: 'error',
  ...(set === 'none' ? { type: GENERIC } : {}),
  ...(hasFrames(set) ? { frames: null } : {}),
});
add(
  '7-proxy-first',
  'AC-7 AC-19',
  "Proxy as the Error's direct prototype, every trap counted",
  all5,
  true,
  [],
  ({ count }) => {
    const error = new Error('m');
    Object.setPrototypeOf(error, spy(count('trap'), Error.prototype));
    return error;
  },
  generic,
);
add(
  '7-proxy-second',
  'AC-7 AC-19',
  'Proxy as the second prototype, every trap counted',
  all5,
  true,
  [],
  ({ count }) => {
    const error = new Error('m');
    Object.setPrototypeOf(error, Object.create(spy(count('trap'), Error.prototype)));
    return error;
  },
  generic,
);
add(
  '7-proxy-deep',
  'AC-7 AC-19',
  'Proxy as the 12th prototype, every trap counted',
  ['none', 'frames'],
  true,
  [],
  ({ count }) => {
    const error = new Error('m');
    Object.setPrototypeOf(error, chain(11, spy(count('trap'), Error.prototype)));
    return error;
  },
  generic,
);
add(
  '7-no-listed-in-16',
  'AC-7',
  'no listed class within 16 prototypes (one 17th), counting accessor on the chain',
  none,
  true,
  ['hot'],
  ({ plant, count }) => {
    const error = new Error('m');
    const middle = chain(16, Error.prototype);
    defineGetter(middle, 'name', count('protoAccessor'), plant.hot);
    Object.setPrototypeOf(error, middle);
    return error;
  },
  () => ERR(GENERIC),
);
add(
  '7-no-listed-in-20',
  'AC-7',
  'no listed class within 20 prototypes',
  none,
  true,
  [],
  () => {
    const error = new Error('m');
    Object.setPrototypeOf(error, chain(20, Error.prototype));
    return error;
  },
  () => ERR(GENERIC),
);
add(
  '7-listed-at-5',
  'AC-7 control',
  'listed class RangeError at the 5th prototype is found',
  none,
  true,
  [],
  () => {
    const error = new Error('m');
    Object.setPrototypeOf(error, chain(4, RangeError.prototype));
    return error;
  },
  () => ERR('RangeError'),
);
add(
  '7-listed-at-15',
  'AC-7 control',
  'listed class TypeError at the 15th prototype is found',
  none,
  true,
  [],
  () => {
    const error = new Error('m');
    Object.setPrototypeOf(error, chain(14, TypeError.prototype));
    return error;
  },
  () => ERR('TypeError'),
);

add(
  '7-stack-assigned',
  'AC-7',
  'stack assigned planted frame-form text, with a counting formatter installed',
  ['none', 'ids', 'text'],
  true,
  ['hot'],
  ({ plant, count, formatter }) => {
    const hit = count('formatter');
    formatter(deferring(hit));
    const error = new Error('m');
    error.stack = frameText(plant).replace('Error: m', 'Error: m');
    return error;
  },
  (set) => ({ kind: 'error', ...(set === 'none' ? { type: 'Error' } : {}), frames: null }),
);
add(
  '7-stack-accessor',
  'AC-7',
  'stack replaced by a counting accessor, options that read no stack',
  ['none', 'ids', 'text'],
  true,
  ['hot'],
  ({ plant, count }) => {
    const hit = count('stackAccessor');
    const error = new Error('m');
    Object.defineProperty(error, 'stack', {
      get() {
        hit();
        return frameText(plant);
      },
      configurable: true,
    });
    return error;
  },
  () => ({ kind: 'error', frames: null }),
);
add(
  '7-formatter-planted',
  'AC-7',
  'Error.prepareStackTrace replaced by a counting formatter returning planted text',
  ['none', 'ids', 'text'],
  true,
  ['hot'],
  ({ plant, count, formatter }) => {
    const hit = count('formatter');
    formatter(() => {
      hit();
      return frameText(plant);
    });
    return new Error('m');
  },
  (set) => ({ kind: 'error', ...(set === 'none' ? { type: 'Error' } : {}), frames: null }),
);
add(
  '7-formatter-planted-plain',
  'AC-7',
  'the same formatter returning a bare marker, an ordinary thrown Error with a marker message',
  none,
  true,
  ['hot', 'mark'],
  ({ plant, count, formatter }) => {
    const hit = count('formatter');
    formatter(() => {
      hit();
      return plant.hot;
    });
    return caught(() => {
      throw new Error(`m ${plant.mark}`);
    });
  },
  () => ERR('Error'),
);

add(
  '18-acme',
  'AC-18',
  'AcmeError extends RangeError, code ACME_FAIL, message and cause messages with markers',
  all5,
  true,
  ['m3'],
  ({ plant, count, formatter, set }) => {
    if (!hasFrames(set)) {
      const hit = count('formatter');
      formatter(() => {
        hit();
        return frameText(plant);
      });
    }
    class AcmeError extends RangeError {}
    const cause = new Error(`cause msg ${plant.m2}`, { cause: new Error(`deeper ${plant.m3}`) });
    return Object.assign(new AcmeError(`acme failed ${plant.m1}`, { cause }), { code: 'ACME_FAIL' });
  },
  (set) => ({
    kind: 'error',
    type: hasIds(set) ? 'AcmeError' : 'RangeError',
    code: hasIds(set) ? 'ACME_FAIL' : null,
    message: hasText(set) ? 'acme failed' : null,
    cause: hasText(set) ? 'cause msg' : null,
    frames: hasFrames(set) ? 'lines' : null,
    absent: hasText(set) ? ['m3'] : ['m1', 'm2', 'm3'],
    absentWhole: [...(hasIds(set) ? [] : ['ACME_FAIL']), ...(hasIds(set) || hasFrames(set) ? [] : ['AcmeError'])],
    framesAbsent: hasFrames(set) ? ['m1', 'm2', 'm3'] : [],
  }),
);

const thrownFrames = (extra: Partial<Want> = {}): Want => ({ kind: 'error', frames: 'lines', ...extra });
add(
  '19-thrown',
  'AC-19',
  'thrown Error with a marker message',
  framesSets,
  true,
  [],
  ({ plant }) =>
    caught(() => {
      throw new Error(`plain ${plant.mark}`);
    }),
  (set) => thrownFrames({ framesAbsent: ['mark'], absent: set === 'all' ? [] : ['mark'] }),
);
add(
  '19-fake-frame',
  'AC-19',
  'thrown Error, 3-line message whose line 2 is a fake frame',
  framesSets,
  true,
  [],
  ({ plant }) =>
    caught(() => {
      throw new Error(`line one\n    at fake (/x/${plant.mark}.js:1:1)\nline three`);
    }),
  (set) =>
    thrownFrames({
      framesAbsent: ['mark', 'line one', 'line three', 'fake'],
      absent: set === 'all' ? [] : ['mark'],
    }),
);
add(
  '19-deep-10',
  'AC-19',
  'Error made 40 calls deep, default stack trace limit',
  framesSets,
  true,
  [],
  () => deepCall(40, () => new Error('deep')),
  () => thrownFrames({ frameCount: 10 }),
);
add(
  '19-deep-limit-50',
  'AC-19',
  'Error made 40 calls deep, Error.stackTraceLimit 50',
  framesSets,
  true,
  [],
  ({ stackLimit }) => {
    stackLimit(50);
    return deepCall(40, () => new Error('deep'));
  },
  () => thrownFrames({ frameCount: 10 }),
);
add(
  '19-stack-accessor',
  'AC-19',
  'stack replaced by a counting accessor',
  framesSets,
  true,
  [],
  ({ count }) => {
    const hit = count('stackAccessor');
    const error = new Error('m');
    Object.defineProperty(error, 'stack', {
      get() {
        hit();
        return 'Error: m\n    at x (/y.js:1:1)';
      },
      configurable: true,
    });
    return error;
  },
  () => ({ kind: 'error', frames: null }),
);
const accessorCases: readonly (readonly [string, string, (env: Env) => Error])[] = [
  [
    'name-own',
    'own name getter',
    ({ plant, count }) => {
      const error = new Error('m');
      defineGetter(error, 'name', count('nameGetter'), plant.hot);
      return error;
    },
  ],
  [
    'message-own',
    'own message getter',
    ({ plant, count }) => {
      const error = new Error('m');
      defineGetter(error, 'message', count('messageGetter'), plant.hot);
      return error;
    },
  ],
  [
    'name-inherited',
    'inherited name getter',
    ({ plant, count }) => {
      class Foo extends Error {}
      const error = new Foo('m');
      defineGetter(Foo.prototype, 'name', count('nameGetter'), plant.hot);
      return error;
    },
  ],
  [
    'message-inherited',
    'inherited message getter',
    ({ plant, count }) => {
      class Foo extends Error {}
      const error = new Foo('m');
      Reflect.deleteProperty(error, 'message');
      defineGetter(Foo.prototype, 'message', count('messageGetter'), plant.hot);
      return error;
    },
  ],
  [
    'name-toString',
    'name is an object with a counting toString',
    ({ plant, count }) => {
      const hit = count('stringified');
      return Object.assign(new Error('m'), {
        name: {
          toString() {
            hit();
            return plant.hot;
          },
        },
      });
    },
  ],
  [
    'message-toString',
    'message is an object with a counting toString',
    ({ plant, count }) => {
      const hit = count('stringified');
      return Object.assign(new Error('m'), {
        message: {
          toString() {
            hit();
            return plant.hot;
          },
        },
      });
    },
  ],
  [
    'proxy-proto',
    'a Proxy among the prototypes, traps counted',
    ({ count }) => {
      const error = new Error('m');
      Object.setPrototypeOf(error, spy(count('trap'), Error.prototype));
      return error;
    },
  ],
];
for (const [id, name, build] of accessorCases) {
  add(`19-${id}`, 'AC-19', name, all5, true, ['hot'], build, (set) => ({
    kind: 'error',
    ...(hasFrames(set) ? { frames: null } : {}),
  }));
}
const formatterCases: readonly (readonly [string, string, (hit: () => void, plant: Plants, env: Env) => Formatter])[] =
  [
    [
      'formatter-throws',
      'Error.prepareStackTrace throws',
      (hit, plant) => () => {
        hit();
        throw new Error(plant.hot);
      },
    ],
    [
      'formatter-object',
      'Error.prepareStackTrace returns an object with a counting toString',
      (hit, plant, env) => () => {
        hit();
        const inner = env.count('resultStringified');
        return {
          toString() {
            inner();
            return frameText(plant);
          },
        };
      },
    ],
    [
      'formatter-plain-object',
      'Error.prepareStackTrace returns a plain object',
      (hit, plant) => () => {
        hit();
        return { planted: plant.hot };
      },
    ],
    [
      'formatter-array',
      'Error.prepareStackTrace returns an array of strings',
      (hit, plant) => () => {
        hit();
        return [`    at planted (/x/${plant.hot}.js:1:1)`];
      },
    ],
  ];
for (const [id, name, make] of formatterCases) {
  add(
    `19-${id}`,
    'AC-19',
    name,
    framesSets,
    true,
    ['hot'],
    (env) => {
      const hit = env.count('formatter');
      env.formatter(make(hit, env.plant, env));
      return new Error('m');
    },
    () => ({ kind: 'error', frames: null, counts: { formatter: 1 } }),
  );
}
add(
  '19-after-throwing-formatter',
  'AC-19',
  'an ordinary read after a throwing formatter still gives frames',
  framesSets,
  true,
  [],
  () => new Error('after'),
  () => ({ kind: 'error', frames: 'lines' }),
);
add(
  '19-nested',
  'AC-19',
  'a formatter that itself logs an error, with frames on',
  framesSets,
  true,
  [],
  (env) => {
    const hit = env.count('formatter');
    env.formatter((error, sites) => {
      hit();
      env.log.error('nested', pastTypes({ e: new Error(`inner ${env.plant.mark}`) }));
      return [Error.prototype.toString.call(error), ...sites.map((site) => `    at ${String(site)}`)].join('\n');
    });
    return new Error('outer');
  },
  () => ({ kind: 'error', frames: 'lines', counts: { formatter: 1 }, nested: true }),
);
add(
  '19-after-nested',
  'AC-19',
  'an ordinary read after the nested case still gives frames',
  framesSets,
  true,
  [],
  () => new Error('after'),
  () => ({ kind: 'error', frames: 'lines' }),
);

const controls: readonly (readonly [string, string, (env: Env) => unknown, Record<string, number>])[] = [
  [
    'stack-accessor',
    'a read of the planted stack accessor is counted',
    ({ count }) => {
      const hit = count('stackAccessor');
      const error = new Error('m');
      Object.defineProperty(error, 'stack', {
        get() {
          hit();
          return 'x';
        },
        configurable: true,
      });
      void error.stack;
      return error;
    },
    { stackAccessor: 1 },
  ],
  [
    'formatter',
    'a read of an ordinary stack runs the planted formatter once',
    ({ count, formatter }) => {
      const hit = count('formatter');
      formatter(deferring(hit));
      const error = new Error('m');
      void error.stack;
      return error;
    },
    { formatter: 1 },
  ],
  [
    'proxy',
    'an operation on the counting Proxy is counted',
    ({ count }) => {
      const proxy = spy(count('trap'), Error.prototype);
      void Reflect.getPrototypeOf(proxy);
      return new Error('m');
    },
    { trap: 1 },
  ],
  [
    'toString',
    'a string conversion of the counting object is counted',
    ({ count }) => {
      const hit = count('stringified');
      void String({
        toString() {
          hit();
          return 'x';
        },
      });
      return new Error('m');
    },
    { stringified: 1 },
  ],
];
for (const [id, name, build, counts] of controls) {
  add(`C-${id}`, 'control', name, none, false, [], build, () => ({ kind: 'error', counts }));
}

const routeGroups = 8;
const failBody = '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}';
const reportShape = t.object({ report: t.string({ maxLength: 8000 }) });
const idParams = t.object({ n: t.string({ maxLength: 64 }) });
const done = t.object({ ok: t.boolean() });

function groupRoutes(prefix: string) {
  const routes: Record<
    string,
    { method: 'GET'; path: string; params: typeof idParams; responses: { 200: typeof done } }
  > = {};
  for (let group = 0; group < routeGroups; group++) {
    routes[`${prefix}${group}`] = {
      method: 'GET',
      path: `/${prefix}${group}/:n`,
      params: idParams,
      responses: { 200: done },
    };
  }
  return routes;
}

const contract = defineContract({
  ...groupRoutes('t'),
  ...groupRoutes('f'),
  counts: { method: 'GET', path: '/counts', responses: { 200: reportShape } },
  five: { method: 'GET', path: '/five', responses: { 200: reportShape } },
  below: { method: 'GET', path: '/below', responses: { 200: reportShape } },
});

async function closeAndExit(server: { close: () => Promise<void> }): Promise<void> {
  await server.close();
  process.exit(0);
}

function serve(setName: SetName): void {
  const plant: Plants = JSON.parse(process.env.LOG_PLANTS ?? '{}');
  const server = createServer({ log: sets[setName] });
  const counters: Record<string, number> = {};
  let restore: (() => void)[] = [];
  const reset = (): void => {
    for (const undo of restore) {
      undo();
    }
    restore = [];
    for (const key of Object.keys(counters)) {
      Reflect.deleteProperty(counters, key);
    }
  };
  const env: Env = {
    plant,
    set: setName,
    cwd: process.cwd(),
    log: server.log,
    count: (key) => {
      counters[key] = 0;
      return () => {
        counters[key] = (counters[key] ?? 0) + 1;
      };
    },
    formatter: (replacement) => {
      const saved = Error.prepareStackTrace;
      restore.push(() => {
        Reflect.set(Error, 'prepareStackTrace', saved);
      });
      Error.prepareStackTrace = replacement;
    },
    stackLimit: (limit) => {
      const saved = Error.stackTraceLimit;
      restore.push(() => {
        Error.stackTraceLimit = saved;
      });
      Error.stackTraceLimit = limit;
    },
  };
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const lookup = (id: string): Fixture => {
    const found = byId.get(id);
    if (found === undefined) {
      throw new Error(`no fixture ${id}`);
    }
    return found;
  };
  const handlers: Record<string, (request: { params: { n: string }; log: Logger }) => unknown> = {};
  for (let group = 0; group < routeGroups; group++) {
    handlers[`t${group}`] = async ({ params }) => {
      reset();
      const { value } = await resolveBuilt(lookup(params.n).build(env));
      throw value;
    };
    handlers[`f${group}`] = async ({ params, log }) => {
      reset();
      const { value } = await resolveBuilt(lookup(params.n).build(env));
      log.error(`field:${params.n}`, pastTypes({ e: value }));
      return { status: 200, body: { ok: true } };
    };
  }
  const five = (): unknown[] => [
    new TypeError('first five'),
    new RangeError('second five'),
    new Error('third five'),
    new Error('fourth five'),
    new Error('fifth five'),
  ];
  handlers.counts = () => {
    const report = JSON.stringify(counters);
    reset();
    return { status: 200, body: { report } };
  };
  handlers.five = ({ log }) => {
    reset();
    env.formatter(deferring(env.count('formatter')));
    const [a, b, c, d, e] = five();
    log.error('five', pastTypes({ a, b, c, d, e }));
    return { status: 200, body: { report: 'five' } };
  };
  handlers.below = ({ log }) => {
    reset();
    env.formatter(deferring(env.count('formatter')));
    const before = server.logStats().created;
    for (let call = 0; call < 1000; call++) {
      const [a, b, c, d, e] = five();
      log.debug('below', pastTypes({ a, b, c, d, e }));
    }
    const after = server.logStats().created;
    return { status: 200, body: { report: JSON.stringify({ before, after }) } };
  };
  server.routes(contract, pastTypes(handlers));
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => {
      process.on('SIGTERM', () => void closeAndExit(server));
      announceListening(port);
    })
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

interface Ran {
  fixture: Fixture;
  mode: 'thrown' | 'field';
  status: number;
  body: string;
  requestId: string | null;
  counts: Record<string, number>;
}

const markers: Record<string, Marker> = {};
for (const name of plantNames) {
  markers[name] = newMarker(name.toUpperCase());
}
const bigMarker = markers.mark;
assert(bigMarker !== undefined);
const numberDigits = String(100_000_000_000 + (randomBytes(5).readUIntBE(0, 5) % 899_999_999_999));
const numberMarker: Marker = {
  whole: numberDigits,
  windows: Array.from({ length: numberDigits.length - 7 }, (_, at) => numberDigits.slice(at, at + 8)),
};
markers.num = numberMarker;
const plantValues: Plants = {
  mark: bigMarker.whole,
  hot: markers.hot?.whole ?? '',
  m1: markers.m1?.whole ?? '',
  m2: markers.m2?.whole ?? '',
  m3: markers.m3?.whole ?? '',
  big: `${bigMarker.whole}${'x'.repeat(129 - bigMarker.whole.length)}`,
  num: Number(numberDigits),
};
markers.big = { whole: plantValues.big, windows: bigMarker.windows };

function markerOf(name: PlantName): Marker {
  const found = markers[name];
  assert(found !== undefined, `no marker ${name}`);
  return found;
}

async function getJson(port: number, path: string): Promise<{ status: number; body: string; rid: string | null }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.text(), rid: response.headers.get('x-request-id') };
}

async function readCounts(port: number): Promise<Record<string, number>> {
  const reply = await getJson(port, '/counts');
  const parsed: unknown = JSON.parse(JSON.parse(reply.body).report);
  assert(typeof parsed === 'object' && parsed !== null);
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, Number(value)]));
}

function isRecord(value: unknown): value is LogObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(record: LogObject, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

interface Part {
  kind: string | null;
  type: string | null;
  code: string | null;
  message: string | null;
  cause: string | null;
  frames: string | null;
}

const engineKeys = [
  'skeld.exception.kind',
  'exception.type',
  'skeld.exception.code',
  'exception.message',
  'skeld.exception.cause',
  'exception.stacktrace',
];

function engineParts(record: LogObject): Part {
  return {
    kind: textOrNull(record, 'skeld.exception.kind'),
    type: textOrNull(record, 'exception.type'),
    code: textOrNull(record, 'skeld.exception.code'),
    message: textOrNull(record, 'exception.message'),
    cause: textOrNull(record, 'skeld.exception.cause'),
    frames: textOrNull(record, 'exception.stacktrace'),
  };
}

function fieldParts(record: LogObject): Part | null {
  const { fields } = record;
  const value = isRecord(fields) ? fields.e : undefined;
  if (isRecord(value)) {
    return {
      kind: 'error',
      type: textOrNull(value, 'type'),
      code: textOrNull(value, 'code'),
      message: textOrNull(value, 'message'),
      cause: textOrNull(value, 'cause'),
      frames: textOrNull(value, 'stacktrace'),
    };
  }
  const empty = { type: null, code: null, message: null, cause: null, frames: null };
  if (value === '[unclassified]') {
    return { kind: 'non_error', ...empty };
  }
  return value === '[invalid]' ? { kind: 'unreadable', ...empty } : null;
}

function accepts(want: Val | undefined, got: string | null): boolean {
  if (want === undefined) {
    return true;
  }
  if (want !== null && typeof want === 'object') {
    return want.oneOf.includes(got);
  }
  return want === got;
}

function isPlantName(name: string): name is PlantName {
  return Object.hasOwn(plantValues, name);
}

function framesProblems(frames: string, want: Want, set: SetName): string[] {
  const problems: string[] = [];
  const lines = frames.split('\n');
  check(problems, lines.length >= 1 && lines.length <= 10, `${lines.length} frames, not 1 to 10`);
  check(
    problems,
    lines.every((line) => /^ {4}at /.test(line) && line.length <= 256),
    'a frames line is not 4 spaces, "at" and at most 256 units',
  );
  if (want.frameCount !== undefined) {
    check(problems, lines.length === want.frameCount, `${lines.length} frames, expected ${want.frameCount}`);
  }
  for (const name of want.framesAbsent ?? []) {
    const marker = isPlantName(name) ? markerOf(name) : { whole: name, windows: [] };
    problems.push(...findMarker(marker, [{ where: `${set} frames`, text: frames }]));
    check(problems, !frames.includes(marker.whole), `the frames hold ${marker.whole}`);
  }
  return problems;
}

function textProblems(part: Part, want: Want): string[] {
  const problems: string[] = [];
  for (const key of ['kind', 'type', 'code', 'message', 'cause'] as const) {
    const expected = want[key];
    const got = part[key];
    const holds = (key === 'message' || key === 'cause') && typeof expected === 'string';
    const fine = holds ? got?.includes(expected) === true : accepts(expected, got);
    check(
      problems,
      fine,
      `${key} is ${JSON.stringify(got)}, expected ${holds ? 'to hold ' : ''}${JSON.stringify(expected)}`,
    );
  }
  return problems;
}

function judge(part: Part, want: Want, set: SetName, counts: Record<string, number>, raw: string): string[] {
  const problems = textProblems(part, want);
  if (want.frames === 'lines') {
    problems.push(...(part.frames === null ? ['frames are absent'] : framesProblems(part.frames, want, set)));
  } else {
    check(problems, accepts(want.frames, part.frames), `frames are ${JSON.stringify(part.frames)?.slice(0, 80)}`);
  }
  const wanted = want.counts ?? {};
  for (const [key, value] of Object.entries(counts)) {
    const expected = Object.hasOwn(wanted, key) ? (wanted[key] ?? 0) : 0;
    check(problems, value === expected, `count ${key} is ${value}, expected ${expected}`);
  }
  for (const key of Object.keys(wanted)) {
    check(problems, key in counts, `count ${key} was never planted`);
  }
  for (const name of want.absent ?? []) {
    problems.push(...findMarker(markerOf(name), [{ where: 'the record', text: raw }]));
  }
  for (const needle of want.absentWhole ?? []) {
    check(problems, !raw.includes(needle), `the record holds ${needle}`);
  }
  if (want.maxJson !== undefined) {
    check(problems, raw.length <= want.maxJson, `the record is ${raw.length} characters`);
  }
  return problems;
}

function lineOf(child: LogChild, found: LogObject): string {
  return child.lines().find((line) => line.object === found)?.text ?? JSON.stringify(found);
}

const codeBlock = readFileSync(fileURLToPath(new URL('../../docs/logging/errors.md', import.meta.url)), 'utf8')
  .split('```text\n')[1]
  ?.split('```')[0];
const codeSet = new Set((codeBlock ?? '').split(/\s+/).filter((word) => word !== ''));
const classSet = new Set([
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'DOMException',
  'HttpError',
  'BootError',
  GENERIC,
]);

interface Found {
  part: Part | null;
  raw: string;
  problems: string[];
}

function thrownRecord(child: LogChild, entry: Ran): Found {
  const problems: string[] = [];
  check(
    problems,
    entry.status === 500 && entry.body === failBody,
    `answered ${entry.status} ${entry.body.slice(0, 80)}`,
  );
  const found = child
    .records()
    .filter((rec) => rec.event_name === 'skeld.request.error' && rec['skeld.request_id'] === entry.requestId);
  check(problems, found.length === 1, `${found.length} skeld.request.error records for the request`);
  const [only] = found;
  if (only === undefined) {
    return { part: null, raw: '', problems };
  }
  for (const key of engineKeys) {
    check(problems, only[key] === undefined || typeof only[key] === 'string', `${key} is not a string`);
  }
  return { part: engineParts(only), raw: lineOf(child, only), problems };
}

function fieldRecord(child: LogChild, entry: Ran): Found {
  const problems: string[] = [];
  check(problems, entry.status === 200, `the call did not return: answered ${entry.status} ${entry.body.slice(0, 80)}`);
  const found = child
    .records()
    .filter((rec) => rec.event_name === 'skeld.app.message' && rec.message === `field:${entry.fixture.id}`);
  check(problems, found.length === 1, `${found.length} author records for the call`);
  const [only] = found;
  if (only === undefined) {
    return { part: null, raw: '', problems };
  }
  const part = fieldParts(only);
  check(problems, part !== null, `fields.e is ${JSON.stringify(only.fields)?.slice(0, 80)}`);
  return { part, raw: lineOf(child, only), problems };
}

function nestedProblems(child: LogChild): string[] {
  const problems: string[] = [];
  const nested = child.records().filter((rec) => rec.event_name === 'skeld.app.message' && rec.message === 'nested');
  check(problems, nested.length >= 1, 'the formatter wrote no nested record');
  for (const rec of nested) {
    const inner = fieldParts(rec);
    check(
      problems,
      inner !== null && inner.kind === 'error' && inner.frames === null,
      `a nested record holds ${JSON.stringify(rec.fields)?.slice(0, 120)}`,
    );
  }
  return problems;
}

function listProblems(part: Part, set: SetName): string[] {
  const problems: string[] = [];
  if (!hasIds(set) && part.kind === 'error') {
    check(problems, part.type === null || classSet.has(part.type), `type ${part.type} is not on the class list`);
    check(problems, part.code === null || codeSet.has(part.code), `code ${part.code} is not on the code set`);
  }
  return problems;
}

function caseProblems(child: LogChild, entry: Ran, set: SetName): { found: Found; problems: string[] } {
  const found = entry.mode === 'thrown' ? thrownRecord(child, entry) : fieldRecord(child, entry);
  const { fixture } = entry;
  const want = fixture.want(set);
  const problems = [...found.problems];
  if (found.part !== null) {
    problems.push(...judge(found.part, want, set, entry.counts, found.raw), ...listProblems(found.part, set));
    if (want.nested === true) {
      problems.push(...nestedProblems(child));
    }
  }
  for (const plantName of fixture.absent) {
    if (!(hasText(set) && plantName === 'mark')) {
      problems.push(...findMarker(markerOf(plantName), [{ where: 'the record', text: found.raw }]));
    }
  }
  return { found, problems };
}

interface Counted {
  status: number;
  body: string;
  counts: Record<string, number>;
}

function fiveProblems(
  child: LogChild,
  set: SetName,
  five: Counted,
  below: Counted,
): { problems: string[]; detail: string } {
  const problems: string[] = [];
  check(problems, five.status === 200 && below.status === 200, 'an AC-17 route did not return');
  const fields = child.records().find((rec) => rec.message === 'five')?.fields;
  check(problems, isRecord(fields), 'no five-error record');
  if (isRecord(fields)) {
    const [first, second] = [fields.a, fields.b];
    check(problems, isRecord(first) && first.type === 'TypeError', `field a is ${JSON.stringify(first)?.slice(0, 80)}`);
    check(
      problems,
      isRecord(second) && second.type === 'RangeError',
      `field b is ${JSON.stringify(second)?.slice(0, 80)}`,
    );
    for (const key of ['c', 'd', 'e']) {
      check(problems, fields[key] === '[unread]', `field ${key} is ${JSON.stringify(fields[key])}, expected [unread]`);
    }
    for (const value of [first, second]) {
      const stack = isRecord(value) ? value.stacktrace : undefined;
      const count = typeof stack === 'string' ? stack.split('\n').length : 0;
      if (hasFrames(set)) {
        check(problems, count >= 1 && count <= 10, `a read error holds ${count} frames with errorFrames on`);
      } else {
        check(problems, stack === undefined, 'a read error holds frames with errorFrames off');
      }
    }
  }
  const formatted = five.counts.formatter ?? Number.NaN;
  check(
    problems,
    hasFrames(set) ? formatted >= 1 && formatted <= 2 : formatted === 0,
    `${formatted} stacks formatted for five errors`,
  );
  const parsed: unknown = JSON.parse(JSON.parse(below.body).report);
  const before = isRecord(parsed) ? Number(parsed.before) : Number.NaN;
  const after = isRecord(parsed) ? Number(parsed.after) : Number.NaN;
  check(problems, below.counts.formatter === 0, `${below.counts.formatter} stacks formatted below the app threshold`);
  check(problems, before === after, `created moved from ${before} to ${after}`);
  check(problems, !child.records().some((rec) => rec.message === 'below'), 'a below-threshold call wrote a record');
  return {
    problems,
    detail: `a and b typed, c d e [unread]; ${formatted} formatted for the five, ${below.counts.formatter} for the 1,000; created ${before} to ${after}`,
  };
}

async function drive(child: LogChild, set: SetName): Promise<{ ran: Ran[]; five: Counted; below: Counted }> {
  const ran: Ran[] = [];
  let group = 0;
  for (const fixture of fixtures.filter((candidate) => candidate.sets.includes(set))) {
    group = (group + 1) % routeGroups;
    for (const mode of fixture.field ? (['thrown', 'field'] as const) : (['thrown'] as const)) {
      const reply = await getJson(child.port, `/${mode === 'thrown' ? 't' : 'f'}${group}/${fixture.id}`);
      ran.push({
        fixture,
        mode,
        status: reply.status,
        body: reply.body,
        requestId: reply.rid,
        counts: await readCounts(child.port),
      });
    }
  }
  const fiveReply = await getJson(child.port, '/five');
  const five = { status: fiveReply.status, body: fiveReply.body, counts: await readCounts(child.port) };
  const belowReply = await getJson(child.port, '/below');
  const below = { status: belowReply.status, body: belowReply.body, counts: await readCounts(child.port) };
  return { ran, five, below };
}

async function runSet(set: SetName, report: ReturnType<typeof createReport>): Promise<void> {
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    args: [set],
    env: { LOG_PLANTS: JSON.stringify(plantValues) },
  });
  let driven: Awaited<ReturnType<typeof drive>>;
  try {
    driven = await drive(child, set);
  } finally {
    await child.stop();
  }
  const searched: Searched[] = [
    ...child.lines().map((line, index) => ({ where: `[${set}] stdout line ${index + 1}`, text: line.text })),
    { where: `[${set}] stdout bytes`, text: child.stdoutBytes().toString('latin1') },
    { where: `[${set}] stderr`, text: child.stderr() },
  ];
  const lineProblems: string[] = [];
  check(lineProblems, child.unparsed().length === 0, `${child.unparsed().length} stdout lines did not parse`);
  check(
    lineProblems,
    child.lines().every((line) => line.byteLength <= 8192),
    'a stdout line is longer than 8,192 bytes',
  );
  check(
    lineProblems,
    !child.records().some((rec) => rec.event_name === 'skeld.log.suppressed'),
    'a suppression summary appeared, so some fixture records were not written',
  );
  report.result(
    `[${set}] the run produced parseable lines only`,
    lineProblems,
    `${child.records().length} records, 0 unparsed, none over 8,192 bytes, no suppression`,
  );
  for (const entry of driven.ran) {
    const { found, problems } = caseProblems(child, entry, set);
    const { part } = found;
    const frameCount = part?.frames === null || part === null ? 'none' : String(part.frames.split('\n').length);
    report.result(
      `${entry.fixture.ac} [${set}] ${entry.mode} ${entry.fixture.id}: ${entry.fixture.name}`,
      problems,
      `${part === null ? 'no record' : `kind ${part.kind}, type ${part.type}, code ${part.code}, frames ${frameCount}`}; counts ${JSON.stringify(entry.counts)}; ${found.raw.length} characters searched`,
    );
  }
  const globalNames: PlantName[] = [
    'hot',
    'm3',
    'num',
    'big',
    ...(hasText(set) ? [] : (['mark', 'm1', 'm2'] as const)),
  ];
  report.result(
    `[${set}] every stdout line, all stdout bytes and stderr searched for the planted markers`,
    globalNames.flatMap((name) =>
      findMarker(name === 'big' && hasText(set) ? { whole: plantValues.big, windows: [] } : markerOf(name), searched),
    ),
    `${searched.length} texts searched for ${globalNames.length} markers, whole and cut, 0 found`,
  );
  const seventeen = fiveProblems(child, set, driven.five, driven.below);
  report.result(
    `AC-17 [${set}] five errors in one call at error, then 1,000 such calls below the app threshold`,
    seventeen.problems,
    seventeen.detail,
  );
}

async function main(): Promise<void> {
  const report = createReport('log-errors');
  for (const set of all5) {
    await runSet(set, report);
  }
  report.finish();
}

if (process.argv[2] === 'serve') {
  const known = all5.find((candidate) => candidate === process.argv[3]);
  if (known === undefined) {
    process.stderr.write(`unknown set ${String(process.argv[3])}\n`);
    process.exitCode = 1;
  } else {
    serve(known);
  }
} else {
  await main();
}
