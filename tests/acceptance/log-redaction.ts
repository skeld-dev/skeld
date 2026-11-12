// Does:  Proves a planted classified or undeclared value never leaves in a record, and a record keeps call-time values.
// Holds: Each protected marker is searched whole and cut in every stdout line, every sink record and all stderr text.

import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import { classified } from '@skeld/core/log';
import * as t from '@skeld/core/schema';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import { announceListening, type LogChild, type LogObject, startLogChild } from './support-log.ts';
import { check, createReport, findMarker, type Marker, newMarker, type Searched } from './support-proof.ts';

const ok = t.object({ ok: t.boolean() });
const signup = t.object({
  email: t.string({ maxLength: 254, sensitivity: 'personal' }),
  password: t.string({ maxLength: 64, sensitivity: 'secret' }),
  plan: t.string({ maxLength: 16 }),
  profile: t.object({
    phone: t.string({ maxLength: 40, sensitivity: 'personal' }),
    city: t.string({ maxLength: 32 }),
  }),
  tokens: t.array(t.string({ maxLength: 64 }), { maxItems: 3, sensitivity: 'secret' }),
  vault: t.object({ pin: t.string({ maxLength: 40 }) }, { sensitivity: 'secret' }),
});
const contract = defineContract({
  fixtures: { method: 'POST', path: '/fixtures', body: signup, responses: { 200: ok } },
  mutate: { method: 'GET', path: '/mutate', responses: { 200: ok } },
  calls: { method: 'GET', path: '/calls', responses: { 200: t.object({ calls: t.integer() }) } },
});

const userShape = t.object({ id: t.string({ maxLength: 36 }) });
const wrongShape = t.object({
  id: t.integer(),
  count: t.integer(),
  flag: t.boolean(),
  inner: t.object({ a: t.string({ maxLength: 40 }) }),
});
const accessorShape = t.object({ id: t.string({ maxLength: 36 }), leak: t.string({ maxLength: 64 }) });
const mutableShape = t.object({
  id: t.string({ maxLength: 36 }),
  n: t.integer(),
  nested: t.object({ x: t.string({ maxLength: 36 }) }),
  list: t.array(t.string({ maxLength: 36 }), { maxItems: 4 }),
});

function pastTypes(value: unknown): never {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the fixtures pass values a log call's types refuse, to see the run-time answer
  return value as never;
}

function serve(): void {
  const planted: Record<string, string> = JSON.parse(process.env.LOG_MARKERS ?? '{}');
  const planting = (name: string): string => planted[name] ?? '';
  let getterCalls = 0;
  const useSink = process.argv[3] === 'sink';
  const server = createServer({
    log: useSink
      ? {
          sink: (records) => {
            let assignment = 'no throw';
            try {
              const writable: string[] = pastTypes(records);
              writable[0] = 'tampered';
            } catch (error) {
              assignment = error instanceof Error ? error.name : 'non-error';
            }
            process.stderr.write(`SINKCHECK frozen=${Object.isFrozen(records)} assign=${assignment}\n`);
            for (const line of records) {
              process.stderr.write(`SINK ${line}\n`);
            }
          },
        }
      : {},
  });
  server.routes(contract, {
    fixtures: ({ log, body, classified: classify }) => {
      log.info('classified-body', { part: classify('body') });
      log.info('classified-email', { email: classify('body', 'email') });
      log.info('classified-password', { password: classify('body', 'password') });
      log.info('secret-wrapped', { password: body.password, tokens: body.tokens, vault: body.vault });
      log.info('secret-new', { s: new Secret(planting('secretNew')) });
      log.info('undeclared', { u: classified(userShape, { id: 'u-1', undeclared: planting('undeclared') }) });
      log.info('wrong-shaped', {
        w: classified(wrongShape, {
          id: planting('wrongId'),
          count: planting('wrongCount'),
          flag: { leak: planting('wrongFlag') },
          inner: planting('wrongInner'),
        }),
      });
      log.info('no-schema', {
        o: pastTypes({ leak: planting('plainObject') }),
        a: pastTypes([planting('plainArray')]),
        f: pastTypes(() => planting('plainFunction')),
        look: pastTypes({ '~classified': true, leak: planting('lookAlike') }),
        sym: pastTypes(Symbol(planting('plainSymbol'))),
      });
      const accessing = {
        id: 'a-1',
        get leak() {
          getterCalls++;
          return planting('accessor');
        },
      };
      const methods = {
        toJSON() {
          getterCalls++;
          return planting('accessorMethod');
        },
        toString() {
          getterCalls++;
          return planting('accessorMethod');
        },
      };
      const trapped = new Proxy(
        {},
        {
          get() {
            getterCalls++;
            return planting('proxy');
          },
          has() {
            getterCalls++;
            return true;
          },
          ownKeys() {
            getterCalls++;
            return ['leak'];
          },
          getOwnPropertyDescriptor() {
            getterCalls++;
            return { value: planting('proxy'), enumerable: true, configurable: true };
          },
          getPrototypeOf() {
            getterCalls++;
            return null;
          },
        },
      );
      log.info('accessor-classified', { o: classified(accessorShape, accessing) });
      log.info('accessor-unclassified', { o: pastTypes(accessing) });
      log.info('accessor-methods', { o: pastTypes(methods) });
      log.info('proxy-classified', { o: classified(accessorShape, trapped) });
      log.info('proxy-unclassified', { o: pastTypes(trapped) });
      log.info('email-direct', { email: body.email });
      log.info('sentinel-fixtures');
      return { status: 200, body: { ok: true } };
    },
    mutate: async ({ log }) => {
      const subject = { id: 'before', n: 1, nested: { x: 'before' }, list: ['before'] };
      log.info('mutate-call', { o: classified(mutableShape, subject) });
      subject.id = 'after-sync';
      subject.n = 2;
      subject.nested.x = 'after-sync';
      subject.list[0] = 'after-sync';
      await delay(0);
      subject.id = 'after-tick';
      subject.nested.x = 'after-tick';
      await delay(60);
      subject.id = 'after-write';
      subject.nested.x = 'after-write';
      subject.list[0] = 'after-write';
      log.info('mutate-control', { o: classified(mutableShape, subject) });
      log.info('sentinel-mutate');
      return { status: 200, body: { ok: true } };
    },
    calls: () => ({ status: 200, body: { calls: getterCalls } }),
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => announceListening(port))
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

interface Capture {
  records: LogObject[];
  searched: Searched[];
  sinkChecks: string[];
  unparsed: number;
}

const protectedNames = [
  'password',
  'phone',
  'token',
  'pin',
  'secretNew',
  'undeclared',
  'wrongId',
  'wrongCount',
  'wrongFlag',
  'wrongInner',
  'plainObject',
  'plainArray',
  'plainFunction',
  'lookAlike',
  'plainSymbol',
  'accessor',
  'accessorMethod',
  'proxy',
] as const;

const markers = new Map<string, Marker>();
for (const name of [...protectedNames, 'email']) {
  markers.set(name, newMarker(name.toUpperCase()));
}

function marker(name: string): Marker {
  const found = markers.get(name);
  if (found === undefined) {
    throw new Error(`no marker named ${name}`);
  }
  return found;
}

const fixtureBody = {
  email: marker('email').whole,
  password: marker('password').whole,
  plan: 'pro',
  profile: { phone: marker('phone').whole, city: 'Oslo' },
  tokens: [marker('token').whole],
  vault: { pin: marker('pin').whole },
};

function post(port: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sinkLines(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('SINK '))
    .map((line) => line.slice(5));
}

function parse(line: string): LogObject | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null;
  } catch {
    return null;
  }
}

function capture(child: LogChild, mode: 'stdout' | 'sink'): Capture {
  const stderr = child.stderr();
  if (mode === 'stdout') {
    const lines = child.lines();
    return {
      records: child.records(),
      searched: [
        ...lines.map((line, index) => ({ where: `stdout line ${index + 1}`, text: line.text })),
        { where: 'stdout bytes', text: child.stdoutBytes().toString('latin1') },
        { where: 'stderr', text: stderr },
      ],
      sinkChecks: [],
      unparsed: child.unparsed().length,
    };
  }
  const lines = sinkLines(stderr);
  const parsed = lines.map(parse);
  return {
    records: parsed.flatMap((record) => (record === null ? [] : [record])),
    searched: [
      ...lines.map((line, index) => ({ where: `sink record ${index + 1}`, text: line })),
      { where: 'stderr', text: stderr },
      { where: 'stdout bytes', text: child.stdoutBytes().toString('latin1') },
    ],
    sinkChecks: stderr.split('\n').filter((line) => line.startsWith('SINKCHECK ')),
    unparsed: parsed.filter((record) => record === null).length + child.unparsed().length,
  };
}

function recordsOf(captured: Capture, message: string): LogObject[] {
  return captured.records.filter((record) => record.message === message);
}

function fieldsOf(captured: Capture, message: string): { found: number; fields: unknown } {
  const matching = recordsOf(captured, message);
  return { found: matching.length, fields: matching[0]?.fields };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function untilText(read: () => string, wanted: string, ms = 8000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (read().includes(wanted)) {
      return true;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a poll waits for the next chunk of the child's stderr
    await delay(10);
  }
  return read().includes(wanted);
}

async function runMode(
  mode: 'stdout' | 'sink',
): Promise<{ captured: Capture; calls: number | null; problems: string[] }> {
  const problems: string[] = [];
  const planted: Record<string, string> = {};
  for (const name of protectedNames) {
    planted[name] = marker(name).whole;
  }
  const child = await startLogChild(fileURLToPath(import.meta.url), {
    args: mode === 'sink' ? ['sink'] : [],
    env: { LOG_MARKERS: JSON.stringify(planted) },
  });
  let calls: number | null = null;
  try {
    const sent = await post(child.port, '/fixtures', fixtureBody);
    check(problems, sent.status === 200, `POST /fixtures answered ${sent.status}`);
    const mutated = await fetch(`http://127.0.0.1:${child.port}/mutate`);
    check(problems, mutated.status === 200, `GET /mutate answered ${mutated.status}`);
    const reported = await fetch(`http://127.0.0.1:${child.port}/calls`);
    const reply: unknown = await reported.json();
    if (typeof reply === 'object' && reply !== null && 'calls' in reply && typeof reply.calls === 'number') {
      calls = reply.calls;
    }
    const sentinels = ['sentinel-fixtures', 'sentinel-mutate'];
    const arrived = await Promise.all(
      sentinels.map((sentinel) =>
        mode === 'stdout'
          ? child
              .waitForRecord((record) => record.message === sentinel, 8000)
              .then(
                () => true,
                () => false,
              )
          : untilText(child.stderr, `"message":"${sentinel}"`),
      ),
    );
    for (const [index, sentinel] of sentinels.entries()) {
      check(problems, arrived[index] === true, `the record ${sentinel} never arrived`);
    }
  } finally {
    await child.stop();
  }
  return { captured: capture(child, mode), calls, problems };
}

function leaks(captured: Capture, names: readonly string[]): string[] {
  return names.flatMap((name) => findMarker(marker(name), captured.searched));
}

function searchedCount(captured: Capture, names: readonly string[]): string {
  return `${captured.searched.length} texts searched for ${names.length} marker${names.length === 1 ? '' : 's'}, whole and cut, 0 found`;
}

async function main(): Promise<void> {
  const report = createReport('log-redaction');
  const expectedProjections = new Map<string, unknown>(
    Object.entries({
      'classified-body': {
        part: {
          email: '[personal]',
          password: '[secret]',
          plan: 'pro',
          profile: { phone: '[personal]', city: 'Oslo' },
          tokens: '[secret]',
          vault: '[secret]',
        },
      },
      'classified-email': { email: '[personal]' },
      'classified-password': { password: '[secret]' },
      'secret-wrapped': { password: '[secret]', tokens: '[secret]', vault: '[secret]' },
      'secret-new': { s: '[secret]' },
      undeclared: { u: { id: 'u-1' } },
      'wrong-shaped': { w: { id: '[invalid]', count: '[invalid]', flag: '[invalid]', inner: '[invalid]' } },
      'no-schema': {
        o: '[unclassified]',
        a: '[unclassified]',
        f: '[unclassified]',
        look: '[unclassified]',
        sym: '[unclassified]',
      },
      'accessor-classified': { o: { id: 'a-1', leak: '[invalid]' } },
      'accessor-unclassified': { o: '[unclassified]' },
      'accessor-methods': { o: '[unclassified]' },
      'proxy-classified': { o: '[invalid]' },
      'proxy-unclassified': { o: '[unclassified]' },
    }),
  );

  const cases: { name: string; messages: string[]; protectedBy: string[]; why: string }[] = [
    {
      name: 'declared secret and personal values (body, nested, array, object)',
      messages: ['classified-body', 'classified-email', 'classified-password', 'secret-wrapped'],
      protectedBy: ['password', 'phone', 'token', 'pin'],
      why: 'secret nodes [secret], personal nodes [personal]',
    },
    {
      name: 'undeclared key',
      messages: ['undeclared'],
      protectedBy: ['undeclared'],
      why: 'only the declared key is written',
    },
    {
      name: 'wrong-shaped values',
      messages: ['wrong-shaped'],
      protectedBy: ['wrongId', 'wrongCount', 'wrongFlag', 'wrongInner'],
      why: 'each is [invalid]',
    },
    {
      name: 'objects without a schema',
      messages: ['no-schema'],
      protectedBy: ['plainObject', 'plainArray', 'plainFunction', 'lookAlike', 'plainSymbol'],
      why: 'object, array, function, look-alike and symbol are [unclassified]',
    },
    { name: 'a Secret', messages: ['secret-new'], protectedBy: ['secretNew'], why: 'written [secret]' },
  ];

  const modes = ['stdout', 'sink'] as const;
  const runs = await Promise.all(modes.map((mode) => runMode(mode)));
  for (const [index, mode] of modes.entries()) {
    const run = runs[index];
    if (run === undefined) {
      throw new Error(`no run for ${mode}`);
    }
    const { captured, calls, problems } = run;
    report.result(
      `AC-1 [${mode}] the run produced parseable lines only`,
      [
        ...problems,
        ...(captured.unparsed === 0 ? [] : [`${captured.unparsed} lines did not parse as one JSON object`]),
      ],
      `${captured.records.length} records read, 0 unparsed, requests answered 200`,
    );
    for (const fixture of cases) {
      const caseProblems: string[] = [];
      for (const message of fixture.messages) {
        const { found, fields } = fieldsOf(captured, message);
        check(caseProblems, found === 1, `${message}: ${found} records instead of 1`);
        const expected = expectedProjections.get(message);
        check(caseProblems, sameJson(fields, expected), `${message}: fields ${JSON.stringify(fields)}`);
      }
      caseProblems.push(...leaks(captured, fixture.protectedBy));
      report.result(
        `AC-1 [${mode}] ${fixture.name}`,
        caseProblems,
        `${fixture.why}; ${searchedCount(captured, fixture.protectedBy)}`,
      );
    }
    const accessorProblems: string[] = [];
    for (const message of [
      'accessor-classified',
      'accessor-unclassified',
      'accessor-methods',
      'proxy-classified',
      'proxy-unclassified',
    ]) {
      const { found, fields } = fieldsOf(captured, message);
      check(accessorProblems, found === 1, `${message}: ${found} records instead of 1`);
      const expected = expectedProjections.get(message);
      check(accessorProblems, sameJson(fields, expected), `${message}: fields ${JSON.stringify(fields)}`);
    }
    check(accessorProblems, calls === 0, `getters, methods and proxy traps ran ${calls} times`);
    accessorProblems.push(...leaks(captured, ['accessor', 'accessorMethod', 'proxy']));
    report.result(
      `AC-1 [${mode}] accessors, toJSON, toString and proxy traps`,
      accessorProblems,
      `0 calls counted by the served module; ${searchedCount(captured, ['accessor', 'accessorMethod', 'proxy'])}`,
    );
    const emailProblems: string[] = [];
    const emailMarker = marker('email');
    const classifiedEmail = fieldsOf(captured, 'classified-email');
    check(
      emailProblems,
      sameJson(classifiedEmail.fields, { email: '[personal]' }),
      'the schema-aware call did not write [personal]',
    );
    const direct = fieldsOf(captured, 'email-direct');
    check(
      emailProblems,
      sameJson(direct.fields, { email: emailMarker.whole }),
      `the direct call wrote ${JSON.stringify(direct.fields)} instead of the address in full`,
    );
    const carrying = captured.searched.filter(
      (text) => text.where !== 'stderr' && text.where !== 'stdout bytes' && text.text.includes(emailMarker.whole),
    );
    check(
      emailProblems,
      carrying.length === 1,
      `the address appears in ${carrying.length} records, not only the direct one`,
    );
    report.result(
      `AC-1 [${mode}] body.email through the schema-aware call and passed directly`,
      emailProblems,
      'classified call wrote [personal]; the direct call wrote the address in full; no other record holds it',
    );
    const mutateProblems: string[] = [];
    const atCall = fieldsOf(captured, 'mutate-call');
    const control = fieldsOf(captured, 'mutate-control');
    check(mutateProblems, atCall.found === 1 && control.found === 1, 'mutate records missing');
    check(
      mutateProblems,
      sameJson(atCall.fields, { o: { id: 'before', n: 1, nested: { x: 'before' }, list: ['before'] } }),
      `mutated after the call, the record held ${JSON.stringify(atCall.fields)}`,
    );
    check(
      mutateProblems,
      sameJson(control.fields, { o: { id: 'after-write', n: 2, nested: { x: 'after-write' }, list: ['after-write'] } }),
      `the control call after the mutation held ${JSON.stringify(control.fields)}`,
    );
    report.result(
      `AC-3 [${mode}] an object mutated after the call is written as it was at the call`,
      mutateProblems,
      'mutated at once, after a tick and after the write window; the record kept the values at the call, a later call shows the new ones',
    );
    if (mode === 'sink') {
      const sinkProblems: string[] = [];
      check(sinkProblems, captured.sinkChecks.length > 0, 'the sink was never called');
      const bad = captured.sinkChecks.filter((line) => line !== 'SINKCHECK frozen=true assign=TypeError');
      check(sinkProblems, bad.length === 0, `sink calls: ${bad.join(' | ')}`);
      const tampered = captured.searched.filter(
        (text) => text.text.includes('tampered') && text.where.startsWith('sink record'),
      );
      check(sinkProblems, tampered.length === 0, 'a record read back as tampered');
      report.result(
        'AC-3 [sink] an assignment to an element of the batch inside a sink throws',
        sinkProblems,
        `${captured.sinkChecks.length} sink calls, each: frozen, assignment threw TypeError, no record altered`,
      );
    }
  }

  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
