// Does:  Proves the error reader on a running server: hostile values thrown from handlers and passed as fields.
// Holds: Each planted marker is searched whole and cut in stdout and stderr; every call count is the served module's.

// biome-ignore-all lint/security/noSecrets: planted markers and fixture names, not credentials
// biome-ignore-all lint/performance/noAwaitInLoops: each fixture is requested alone so its counts and records stay its own
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { defineContract } from '@skeld/core/contract';
import type { Logger } from '@skeld/core/log';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogChild, type LogObject, startLogChild } from '../support/support-log.ts';
import { check, createReport, findMarker, type Marker, newMarker, type Searched } from '../support/support-proof.ts';

type SetName = 'none' | 'frames' | 'all';
type Val = string | null | { oneOf: readonly (string | null)[] };
type Formatter = (error: Error, sites: readonly unknown[]) => unknown;

const sets: Record<SetName, { errorIdentifiers: boolean; errorText: boolean; errorFrames: boolean }> = {
  none: { errorIdentifiers: false, errorText: false, errorFrames: false },
  frames: { errorIdentifiers: false, errorText: false, errorFrames: true },
  all: { errorIdentifiers: true, errorText: true, errorFrames: true },
};
const setNames: readonly SetName[] = ['none', 'frames', 'all'];
const hasFrames = (set: SetName): boolean => set !== 'none';
const hasIds = (set: SetName): boolean => set === 'all';
const hasText = (set: SetName): boolean => set === 'all';

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

function caught(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  throw new Error('the fixture did not throw');
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

function countingString(hit: () => void, text: string): { toString(): string; valueOf(): string } {
  return {
    toString() {
      hit();
      return text;
    },
    valueOf() {
      hit();
      return text;
    },
  };
}

const fixtures: Fixture[] = [];
function add(
  id: string,
  name: string,
  setList: readonly SetName[],
  field: boolean,
  absent: readonly PlantName[],
  build: (env: Env) => unknown,
  want: (set: SetName) => Want,
): void {
  fixtures.push({ id, name, sets: setList, field, absent, build, want });
}
const none: readonly SetName[] = ['none'];
const both: readonly SetName[] = ['none', 'all'];
const framed: readonly SetName[] = ['all'];

// Why: Ordinary errors share one observable shape, so one of each construction path stands for its kind.
const plainCases: readonly (readonly [string, string, boolean, (env: Env) => unknown, Want])[] = [
  ['plain', 'Error, marker message', true, ({ plant }) => new Error(`plain ${plant.mark}`), ERR('Error')],
  [
    'cyclic-cause',
    "two Errors each the other's cause",
    true,
    ({ plant }) => {
      const first = new Error(`a ${plant.mark}`);
      const second = new Error(`b ${plant.mark}`, { cause: first });
      first.cause = second;
      return first;
    },
    ERR('Error'),
  ],
  [
    'aggregate',
    'AggregateError of two Errors',
    false,
    ({ plant }) =>
      new AggregateError([new Error(`agg1 ${plant.mark}`), new Error(`agg2 ${plant.mark}`)], `aggregate ${plant.mark}`),
    ERR('AggregateError'),
  ],
  [
    'own-props',
    'Error with own userId and token properties',
    false,
    ({ plant }) => Object.assign(new Error(`props ${plant.mark}`), { userId: 42, token: plant.mark }),
    ERR('Error'),
  ],
  [
    'json-parse',
    'JSON.parse of a text with a trailing comma',
    false,
    ({ plant }) => caught(() => JSON.parse(`{"password":"${plant.mark}",}`)),
    ERR('SyntaxError'),
  ],
  [
    'url',
    'new URL with a marker in its credentials',
    false,
    ({ plant }) => caught(() => new URL(`http://user:${plant.mark}@[bad`)),
    ERR('TypeError'),
  ],
  [
    'structured-clone',
    'structuredClone of a function',
    false,
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
    'foreign-realm',
    'Error from another vm realm',
    true,
    ({ plant }) => runInNewContext(`new Error("${plant.mark}")`),
    ERR(GENERIC),
  ],
  [
    'huge-message',
    'Error with a 1 MiB message',
    true,
    ({ plant }) => new Error(plant.mark + 'x'.repeat(1024 * 1024 - plant.mark.length)),
    { ...ERR('Error'), maxJson: 1000 },
  ],
  [
    'recursion',
    'RangeError from unbounded recursion',
    false,
    () => {
      const recurse = (): number => recurse() + 1;
      return caught(recurse);
    },
    ERR('RangeError'),
  ],
  [
    'enoent',
    'failed read of a missing file whose path holds a marker',
    false,
    ({ plant }) => caught(() => readFileSync(`/nonexistent/${plant.mark}.txt`)),
    ERR('Error', 'ENOENT'),
  ],
];
for (const [id, name, field, build, want] of plainCases) {
  add(id, name, none, field, ['mark'], build, () => want);
}

for (const [id, name, make] of [
  ['string', "throw 'string marker'", (p: Plants) => `string ${p.mark}`],
  ['number', 'throw 42', () => 42],
  ['null', 'throw null', () => null],
  ['undefined', 'throw undefined', () => undefined],
  ['symbol', 'throw Symbol(marker)', (p: Plants) => Symbol(p.mark)],
] as const) {
  add(
    `thrown-${id}`,
    name,
    none,
    false,
    ['mark'],
    ({ plant }) => make(plant),
    () => NON,
  );
}
add(
  'error-like',
  "throw { code: 'E', message: marker }",
  none,
  true,
  ['mark'],
  ({ plant }) => ({ code: 'E', message: plant.mark }),
  () => NON,
);
add(
  'getter-throws',
  'plain object whose message getter throws',
  both,
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
  'getters-counted',
  'plain object with counting name getter, toString, toJSON and constructor getter',
  both,
  false,
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
add(
  'stack-throws',
  'Error whose own stack is a throwing, counting accessor',
  both,
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
  (set) => ({
    kind: 'error',
    ...(hasIds(set) ? {} : { type: 'Error', code: null }),
    ...(hasFrames(set) ? { frames: null } : {}),
  }),
);
add(
  'stack-planted',
  'Error whose own stack is a counting accessor returning planted frame text',
  both,
  false,
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
  () => ({ kind: 'error', frames: null }),
);
add(
  'proxy-throws',
  'Proxy of an Error whose every trap counts and throws',
  both,
  true,
  ['hot'],
  ({ plant, count }) => throwingProxy(count('trap'), new Error('proxied'), plant.hot),
  () => FALLBACK,
);
add(
  'proxy-passes',
  'Proxy of an Error with counting pass-through traps',
  both,
  false,
  ['mark'],
  ({ plant, count }) => spy(count('trap'), new Error(`proxied ${plant.mark}`)),
  () => FALLBACK,
);

const plants: readonly (readonly [string, (plant: Plants) => unknown, readonly PlantName[]])[] = [
  ['marker', (plant) => plant.mark, ['mark']],
  ['number', (plant) => plant.num, ['mark', 'num']],
];
for (const [label, make, absent] of plants) {
  add(
    `name-${label}`,
    `thrown value whose name is a ${label}`,
    none,
    false,
    absent,
    ({ plant }) => Object.assign(new Error('m'), { name: make(plant) }),
    () => ERR('Error'),
  );
  add(
    `code-${label}`,
    `thrown value whose code is a ${label}`,
    none,
    false,
    absent,
    ({ plant }) => Object.assign(new Error('m'), { code: make(plant) }),
    () => ERR('Error'),
  );
}
add(
  'name-code-objects',
  'thrown value whose name and code are objects with a counting toString',
  none,
  false,
  ['mark'],
  ({ plant, count }) => {
    const hit = count('stringified');
    return Object.assign(new Error('m'), {
      name: countingString(hit, plant.mark),
      code: countingString(hit, plant.mark),
    });
  },
  () => ERR('Error'),
);
add(
  'name-code-129-frames',
  'name and code are 129-character strings, with errorFrames alone',
  ['frames'],
  false,
  ['mark'],
  ({ plant }) => Object.assign(new Error('m'), { name: plant.big, code: plant.big }),
  () => ({ kind: 'error', type: 'Error', code: null }),
);
add(
  'class-and-code',
  'class named by the marker extending RangeError with code ERR_ and the marker',
  none,
  false,
  ['mark'],
  ({ plant }) => {
    const Named = { [plant.mark]: class extends RangeError {} }[plant.mark];
    assert(Named !== undefined);
    return Object.assign(new Named('m'), { code: `ERR_${plant.mark}` });
  },
  () => ERR('RangeError'),
);

add(
  'proxy-proto',
  "Proxy as the Error's direct prototype, every trap counted",
  both,
  true,
  [],
  ({ count }) => {
    const error = new Error('m');
    Object.setPrototypeOf(error, spy(count('trap'), Error.prototype));
    return error;
  },
  (set) => ({
    kind: 'error',
    ...(set === 'none' ? { type: GENERIC } : {}),
    ...(hasFrames(set) ? { frames: null } : {}),
  }),
);
add(
  'proxy-deep',
  'Proxy as the 12th prototype, every trap counted',
  none,
  false,
  [],
  ({ count }) => {
    const error = new Error('m');
    Object.setPrototypeOf(error, chain(11, spy(count('trap'), Error.prototype)));
    return error;
  },
  () => ({ kind: 'error', type: GENERIC, frames: null }),
);
add(
  'no-listed-in-16',
  'no listed class within 16 prototypes (one 17th), counting accessor on the chain',
  none,
  false,
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
  'listed-at-15',
  'control: listed class TypeError at the 15th prototype is found',
  none,
  false,
  [],
  () => {
    const error = new Error('m');
    Object.setPrototypeOf(error, chain(14, TypeError.prototype));
    return error;
  },
  () => ERR('TypeError'),
);

add(
  'stack-assigned',
  'stack assigned planted frame-form text, with a counting formatter installed',
  none,
  false,
  ['hot'],
  ({ plant, count, formatter }) => {
    const hit = count('formatter');
    formatter(deferring(hit));
    const error = new Error('m');
    error.stack = frameText(plant);
    return error;
  },
  () => ({ kind: 'error', type: 'Error', frames: null }),
);
add(
  'acme',
  'AcmeError extends RangeError, code ACME_FAIL, message and cause messages with markers',
  setNames,
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

add(
  'fake-frame',
  'thrown Error, 3-line message whose line 2 is a fake frame',
  framed,
  false,
  [],
  ({ plant }) =>
    caught(() => {
      throw new Error(`line one\n    at fake (/x/${plant.mark}.js:1:1)\nline three`);
    }),
  () => ({ kind: 'error', frames: 'lines', framesAbsent: ['mark', 'line one', 'line three', 'fake'] }),
);
add(
  'deep-limit-50',
  'Error made 40 calls deep, Error.stackTraceLimit 50',
  framed,
  false,
  [],
  ({ stackLimit }) => {
    stackLimit(50);
    return deepCall(40, () => new Error('deep'));
  },
  () => ({ kind: 'error', frames: 'lines', frameCount: 10 }),
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
    'message-toString',
    'message is an object with a counting toString',
    ({ plant, count }) => Object.assign(new Error('m'), { message: countingString(count('stringified'), plant.hot) }),
  ],
];
for (const [id, name, build] of accessorCases) {
  add(id, name, both, false, ['hot'], build, (set) => ({
    kind: 'error',
    ...(hasFrames(set) ? { frames: null } : {}),
  }));
}
const formatterCases: readonly (readonly [string, string, boolean, (hit: () => void, env: Env) => Formatter])[] = [
  [
    'formatter-throws',
    'Error.prepareStackTrace throws',
    true,
    (hit, env) => () => {
      hit();
      throw new Error(env.plant.hot);
    },
  ],
  [
    'formatter-object',
    'Error.prepareStackTrace returns an object with a counting toString',
    false,
    (hit, env) => () => {
      hit();
      return countingString(env.count('resultStringified'), frameText(env.plant));
    },
  ],
];
for (const [id, name, field, make] of formatterCases) {
  add(
    id,
    name,
    framed,
    field,
    ['hot'],
    (env) => {
      env.formatter(make(env.count('formatter'), env));
      return new Error('m');
    },
    () => ({ kind: 'error', frames: null, counts: { formatter: 1 } }),
  );
}
add(
  'after-throwing-formatter',
  'an ordinary read after a throwing formatter still gives frames',
  framed,
  false,
  [],
  () => new Error('after'),
  () => ({ kind: 'error', frames: 'lines' }),
);
add(
  'nested',
  'a formatter that itself logs an error, with frames on',
  framed,
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
  'after-nested',
  'an ordinary read after the nested case still gives frames',
  framed,
  false,
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
      void String(countingString(count('stringified'), 'x'));
      return new Error('m');
    },
    { stringified: 1 },
  ],
];
for (const [id, name, build, counts] of controls) {
  add(`control-${id}`, `control: ${name}`, none, false, [], build, () => ({ kind: 'error', counts }));
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
    handlers[`t${group}`] = ({ params }) => {
      reset();
      throw lookup(params.n).build(env);
    };
    handlers[`f${group}`] = ({ params, log }) => {
      reset();
      log.error(`field:${params.n}`, pastTypes({ e: lookup(params.n).build(env) }));
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
const numberDigits = String(randomInt(100_000_000_000, 999_999_999_999));
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

function fiveProblems(child: LogChild, set: SetName, five: Counted): { problems: string[]; detail: string } {
  const problems: string[] = [];
  check(problems, five.status === 200, 'the five route did not return');
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
  return {
    problems,
    detail: `a and b typed, c d e [unread]; ${formatted} formatted for the five`,
  };
}

async function drive(child: LogChild, set: SetName): Promise<{ ran: Ran[]; five: Counted }> {
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
  return { ran, five };
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
      `[${set}] ${entry.mode} ${entry.fixture.id}: ${entry.fixture.name}`,
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
  const seventeen = fiveProblems(child, set, driven.five);
  report.result(`[${set}] five errors in one call at error`, seventeen.problems, seventeen.detail);
}

async function main(): Promise<void> {
  const report = createReport();
  for (const set of setNames) {
    await runSet(set, report);
  }
  report.finish();
}

if (process.argv[2] === 'serve') {
  const known = setNames.find((candidate) => candidate === process.argv[3]);
  if (known === undefined) {
    process.stderr.write(`unknown set ${String(process.argv[3])}\n`);
    process.exitCode = 1;
  } else {
    serve(known);
  }
} else {
  await main();
}
