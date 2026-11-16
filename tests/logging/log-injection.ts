// Does:  Proves hostile text in a log call stays one bounded JSON line, also in a full queue behind a silent reader.
// Holds: Every stdout line is checked for parse, byte bound, one per record and engine keys, in both runs.

// biome-ignore-all lint/security/noSecrets: planted hostile text and percent-encoded paths, not credentials
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import {
  announceListening,
  type LogChild,
  type LogLine,
  type LogObject,
  startLogChild,
} from '../support/support-log.ts';
import { check, createReport } from '../support/support-proof.ts';
import { request as wireRequest } from '../support/support-wire.ts';

const lineBound = 8192;
const queueCap = 1024 * 1024;

function holdsRawControl(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    const unit = text.charCodeAt(at);
    if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f) || unit === 0x2028 || unit === 0x2029) {
      return true;
    }
  }
  return false;
}
const engineKeys = [
  'time',
  'severity_text',
  'severity_number',
  'event_name',
  'message',
  'trace_id',
  'trace_flags',
  'skeld.category',
  'skeld.request_id',
  'http.request.header.x-request-id',
  'http.request.method',
  'http.route',
  'http.response.status_code',
  'error.type',
  'client.address',
  'skeld.reason',
  'skeld.exception.kind',
  'exception.type',
  'skeld.exception.code',
  'exception.message',
  'skeld.exception.cause',
  'exception.stacktrace',
  'skeld.outcome',
  'skeld.duration_ms',
  'fields',
  'skeld.omitted',
] as const;
const severities: ReadonlyMap<string, number> = new Map([
  ['debug', 5],
  ['info', 9],
  ['warn', 13],
  ['error', 17],
  ['fatal', 21],
]);

const controls = Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join('');
const c1Controls = Array.from({ length: 33 }, (_, code) => String.fromCharCode(0x7f + code)).join('');
const hostileTexts: readonly (readonly [string, string])[] = [
  ['controls', `a${controls}${c1Controls}z`],
  ['separators', 'line\u2028sep\u2029end'],
  ['quotes', `say "hi" 'there' \\ back\\slash \\" \\u0041 "}`],
  ['forged-line', 'x"}\n{"time":"2020-01-01T00:00:00.000Z","severity_text":"fatal","event_name":"FORGED_EVENT"}\r\n'],
  ['forged-inline', '","event_name":"FORGED_EVENT","skeld.category":"security'],
  ['lone-high', 'before\ud800after'],
  ['lone-low', 'before\udc00after'],
  ['lone-pair-order', '\udc00\ud800 and \ud83d at the end\ud83d'],
  ['valid-pair', 'smile \ud83d\ude00 and \u20ac and \u00e9'],
  ['nul-only', '\u0000'],
];
const hostileMessage = hostileTexts.map(([, text]) => text).join('|');
const hostileNames: readonly string[] = [
  'quote"name',
  'new\nline',
  '"},"event_name":"FORGED_EVENT',
  'sep\u2028arate',
  'lone\ud800name',
  '__proto__',
  'constructor',
  'toString',
];
const appValue = (key: string): string => `APPVAL_${key.replaceAll(/[^A-Za-z0-9]/g, '_')}`;

const ok = t.object({ ok: t.boolean() });
const contract = defineContract({
  inject: { method: 'GET', path: '/inject', responses: { 200: ok } },
  throwing: { method: 'GET', path: '/throwing', responses: { 200: ok } },
  flood: {
    method: 'GET',
    path: '/flood',
    query: t.object({
      count: t.integer({ minimum: 1, maximum: 2000 }),
    }),
    responses: { 200: ok },
  },
  stats: { method: 'GET', path: '/stats', responses: { 200: t.object({ text: t.string({ maxLength: 2000 }) }) } },
});

function engineNamedFields(): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of engineKeys) {
    fields[key] = appValue(key);
  }
  return fields;
}

function hostileFields(): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [label, text] of hostileTexts) {
    fields[`text-${label}`] = text;
  }
  for (const name of hostileNames) {
    Object.defineProperty(fields, name, {
      value: appValue(name),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return fields;
}

// Why: Each unit is written with a different number of bytes, so the same size aims every record at the bound.
const floodUnits: readonly (readonly [string, number])[] = [
  ['a', 1],
  ['\u0001', 6],
  ['\u20ac', 3],
  ['\ud83d\ude00', 4],
  ['\ud800', 3],
  ['"', 2],
  ['\u00e9', 2],
  ['\u2028', 6],
];

function floodRecord(index: number): { message: string; fields: Record<string, string> } {
  const [unit, bytesPerUnit] = floodUnits[index % floodUnits.length] ?? ['a', 1];
  const text = unit.repeat(Math.max(1, Math.floor((280 + (index % 16) * 6) / bytesPerUnit)));
  const fields: Record<string, string> = {};
  for (let at = 0; at < 32; at++) {
    fields[`f${at}`] = text;
  }
  return { message: text, fields };
}

class HostileError extends Error {}
Object.defineProperty(HostileError, 'name', { value: 'Host"ile\n{"event_name":"FORGED_EVENT"}\u2028\ud800' });

function serve(): void {
  const server = createServer({
    log: { thresholds: { security: 'info' }, errorIdentifiers: true, errorText: true },
  });
  server.routes(contract, {
    inject: ({ log }) => {
      log.info(`inject-request-engine ${hostileMessage}`, engineNamedFields());
      log.info(`inject-request-hostile ${hostileMessage}`, hostileFields());
      server.log.warn('inject-server-engine \n"}\u0000\ud800', engineNamedFields());
      server.log.warn('inject-server-hostile \n"}\u0000\ud800', hostileFields());
      return { status: 200, body: { ok: true } };
    },
    throwing: () => {
      throw Object.assign(
        new HostileError('msg "q" \n\u0000 \ud800 {"event_name":"FORGED_EVENT"}', {
          cause: new Error('cause "q" \n\u2029 \udc00 {"event_name":"FORGED_EVENT"}'),
        }),
        { code: 'CO"DE\n\u0001\ud800' },
      );
    },
    flood: ({ query, log }) => {
      for (let index = 0; index < query.count; index++) {
        const { message, fields } = floodRecord(index);
        log.warn(message, fields);
      }
      return { status: 200, body: { ok: true } };
    },
    stats: () => ({ status: 200, body: { text: JSON.stringify(server.logStats()) } }),
  });
  server
    .listen({ port: 0, host: '127.0.0.1' })
    .then(({ port }) => announceListening(port))
    .catch((error: unknown) => {
      process.stderr.write(`serve failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

interface Stats {
  created: number;
  written: number;
  queued: number;
  queuedBytes: number;
  inFlight: number;
  inFlightBytes: number;
  dropped: Record<string, number>;
}

function isStats(value: unknown): value is Stats {
  return (
    typeof value === 'object' &&
    value !== null &&
    'created' in value &&
    typeof value.created === 'number' &&
    'written' in value &&
    typeof value.written === 'number' &&
    'queued' in value &&
    typeof value.queued === 'number' &&
    'queuedBytes' in value &&
    typeof value.queuedBytes === 'number' &&
    'inFlight' in value &&
    typeof value.inFlight === 'number' &&
    'inFlightBytes' in value &&
    typeof value.inFlightBytes === 'number' &&
    'dropped' in value &&
    typeof value.dropped === 'object' &&
    value.dropped !== null
  );
}

async function readStats(port: number): Promise<Stats> {
  const response = await fetch(`http://127.0.0.1:${port}/stats`);
  const reply: unknown = await response.json();
  if (typeof reply !== 'object' || reply === null || !('text' in reply) || typeof reply.text !== 'string') {
    throw new Error('the stats route answered no text');
  }
  const parsed: unknown = JSON.parse(reply.text);
  if (!isStats(parsed)) {
    throw new Error(`the stats route answered ${reply.text}`);
  }
  return parsed;
}

function droppedTotal(stats: Stats): number {
  return Object.values(stats.dropped).reduce((sum, count) => sum + count, 0);
}

interface Observed {
  problems: string[];
  lines: number;
  maxBytes: number;
  nearBound: number;
}

function observeLines(child: LogChild): Observed {
  const lines: LogLine[] = child.lines();
  const problems: string[] = [];
  const counts = new Map<string, number>();
  const note = (kind: string, detail: string): void => {
    const seen = counts.get(kind) ?? 0;
    counts.set(kind, seen + 1);
    if (seen === 0) {
      problems.push(`${kind}: first at ${detail}`);
    }
  };
  let maxBytes = 0;
  let nearBound = 0;
  for (const [index, line] of lines.entries()) {
    const where = `line ${index + 1}`;
    maxBytes = Math.max(maxBytes, line.byteLength);
    if (line.byteLength >= lineBound - 200) {
      nearBound++;
    }
    if (!line.terminated) {
      note('line without its newline', where);
    }
    if (!line.validUtf8) {
      note('line that is not valid UTF-8', where);
    }
    if (line.object === null) {
      note('line that does not parse as one JSON object', `${where}: ${line.text.slice(0, 80)}`);
      continue;
    }
    if (line.byteLength > lineBound) {
      note('line over 8,192 bytes', `${where}: ${line.byteLength}`);
    }
    if (holdsRawControl(line.text)) {
      note('line holding a raw control, separator or C1 character', where);
    }
    const record = line.object;
    const severity = record.severity_text;
    const engineShape =
      typeof record.time === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.time) &&
      typeof severity === 'string' &&
      severities.get(severity) === record.severity_number &&
      typeof record.event_name === 'string' &&
      /^skeld\.[a-z_.]+$/.test(record.event_name) &&
      ['boot', 'app', 'security', 'access'].includes(String(record['skeld.category']));
    if (!engineShape) {
      note('line whose engine keys are not the engine own', `${where}: ${line.text.slice(0, 120)}`);
    }
    if (record.event_name === 'FORGED_EVENT' || line.text.startsWith('{"event_name":"FORGED_EVENT')) {
      note('forged record', where);
    }
  }
  const bytes = child.stdoutBytes();
  const newlines = bytes.filter((byte) => byte === 0x0a).length;
  const returns = bytes.filter((byte) => byte === 0x0d).length;
  check(problems, newlines === lines.length, `${newlines} newlines for ${lines.length} lines`);
  check(problems, returns === 0, `${returns} carriage returns on stdout`);
  check(problems, child.unparsed().length === 0, `${child.unparsed().length} unparsed or unterminated lines`);
  for (const [kind, count] of counts) {
    if (count > 1) {
      problems.push(`${kind}: ${count} lines in all`);
    }
  }
  return { problems, lines: lines.length, maxBytes, nearBound };
}

function hostileExpectation(label: string, text: string): [string, string] {
  return [`text-${label}`, text.toWellFormed()];
}

function checkHostileRecord(
  record: LogObject | undefined,
  requestId: string | null,
  label: string,
  kind: 'engine' | 'hostile',
  message: string,
): string[] {
  const problems: string[] = [];
  if (record === undefined) {
    return [`${label}: no record found`];
  }
  const fields = record.fields;
  check(problems, record.message === message, `${label}: the message reads ${JSON.stringify(record.message)}`);
  check(problems, record.event_name === 'skeld.app.message', `${label}: event_name is ${String(record.event_name)}`);
  check(problems, record['skeld.category'] === 'app', `${label}: category is ${String(record['skeld.category'])}`);
  if (requestId === null) {
    check(problems, !('skeld.request_id' in record), `${label}: a server record carries a request id`);
  } else {
    check(
      problems,
      record['skeld.request_id'] === requestId,
      `${label}: skeld.request_id is ${String(record['skeld.request_id'])}`,
    );
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'fields' || key === 'message') {
      continue;
    }
    check(problems, !JSON.stringify(value).includes('APPVAL_'), `${label}: engine key ${key} holds an app value`);
  }
  check(
    problems,
    !('trace_id' in record) && !('http.route' in record),
    `${label}: an engine key was added from app fields`,
  );
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return [...problems, `${label}: fields is not an object`];
  }
  const written = new Map(Object.entries(fields));
  const engineNamed = kind === 'engine' ? engineKeys : [];
  const textKeys = kind === 'hostile' ? hostileTexts : [];
  const nameKeys = kind === 'hostile' ? hostileNames : [];
  for (const key of engineNamed) {
    check(
      problems,
      written.get(key) === appValue(key),
      `${label}: app field ${key} reads ${JSON.stringify(written.get(key))}`,
    );
  }
  for (const [name, text] of textKeys) {
    const [key, expected] = hostileExpectation(name, text);
    check(problems, written.get(key) === expected, `${label}: ${key} reads ${JSON.stringify(written.get(key))}`);
  }
  for (const name of nameKeys) {
    check(
      problems,
      written.get(name.toWellFormed()) === appValue(name),
      `${label}: field name ${JSON.stringify(name)} is missing or altered`,
    );
  }
  const expectedKeys = new Set([
    ...engineNamed,
    ...textKeys.map(([name]) => `text-${name}`),
    ...nameKeys.map((name) => name.toWellFormed()),
  ]);
  const extra = [...written.keys()].filter((key) => !expectedKeys.has(key));
  const missing = [...expectedKeys].filter((key) => !written.has(key));
  check(
    problems,
    extra.length === 0 && missing.length === 0,
    `${label}: extra field names ${extra.join(',')}, missing ${missing.join(',')}`,
  );
  return problems;
}

async function untilLines(child: LogChild, count: number, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.lines().length >= count) {
      return true;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a poll waits for the next chunk of the child's stdout
    await delay(20);
  }
  return child.lines().length >= count;
}

async function hostileRun(report: ReturnType<typeof createReport>): Promise<void> {
  const child = await startLogChild(fileURLToPath(import.meta.url));
  try {
    const injected = await fetch(`http://127.0.0.1:${child.port}/inject`);
    const requestId = injected.headers.get('x-request-id');
    await fetch(`http://127.0.0.1:${child.port}/throwing`);
    const paths = [
      '/%00%1b%22%7d%0a%7b%22event_name%22:%22FORGED_EVENT%22%7d',
      '/no%C2%85such%E2%80%A8path%22',
      '/%ED%A0%80lone',
    ];
    for (const path of paths) {
      // biome-ignore lint/performance/noAwaitInLoops: each hostile request is answered before the next
      await wireRequest(child.port, 'GET', path, ['x-probe: "}\\u0000 {"event_name":"FORGED_EVENT"}']);
    }
    await wireRequest(child.port, 'GET', '/inject', ['x-request-id: "}\\u0000 {"event_name":"FORGED_EVENT"}']);
    await delay(100);
    const stats = await readStats(child.port);
    const reached = await untilLines(child, stats.created);
    const afterStats = await readStats(child.port);
    const reachedAll = reached && (await untilLines(child, afterStats.created));
    const mapped = child.records();
    const find = (prefix: string): LogObject | undefined =>
      mapped.find((record) => String(record.message).startsWith(prefix));
    const requestMessage = hostileMessage.toWellFormed();
    const serverMessage = '\n"}\u0000\ufffd';
    const injectionProblems = [
      ...checkHostileRecord(
        find('inject-request-engine '),
        requestId,
        'request logger, engine-named fields',
        'engine',
        `inject-request-engine ${requestMessage}`,
      ),
      ...checkHostileRecord(
        find('inject-request-hostile '),
        requestId,
        'request logger, hostile fields',
        'hostile',
        `inject-request-hostile ${requestMessage}`,
      ),
      ...checkHostileRecord(
        find('inject-server-engine '),
        null,
        'server logger, engine-named fields',
        'engine',
        `inject-server-engine ${serverMessage}`,
      ),
      ...checkHostileRecord(
        find('inject-server-hostile '),
        null,
        'server logger, hostile fields',
        'hostile',
        `inject-server-hostile ${serverMessage}`,
      ),
    ];
    report.result(
      'AC-2 hostile text in a message, field values, field names and engine-named app fields',
      injectionProblems,
      'control, C1, separator, quote, backslash, forged-line and lone-surrogate text round-trips escaped; every engine key keeps the engine value; app fields sit under fields',
    );
    const observed = observeLines(child);
    check(observed.problems, reachedAll, 'the lines never caught up with the records created');
    check(
      observed.problems,
      observed.lines === afterStats.created && afterStats.written === afterStats.created,
      `${observed.lines} lines for ${afterStats.created} created and ${afterStats.written} written`,
    );
    report.result(
      'AC-2 every stdout line: one JSON object, at most 8,192 bytes, one per record, nothing forged (hostile run)',
      observed.problems,
      `${observed.lines} lines, ${afterStats.created} records created and written, longest ${observed.maxBytes} bytes, no raw control character, no forged record`,
    );
  } finally {
    await child.stop();
  }
}

async function ceilingRun(report: ReturnType<typeof createReport>): Promise<void> {
  const silentMs = 3000;
  const child = await startLogChild(fileURLToPath(import.meta.url), { reader: { mode: 'silent', ms: silentMs } });
  try {
    const preconditions: string[] = [];
    const flood = await fetch(`http://127.0.0.1:${child.port}/flood?count=400`);
    check(preconditions, flood.status === 200, `the flood request answered ${flood.status}`);
    let peakBytes = 0;
    const sample = async (): Promise<Stats> => {
      const stats = await readStats(child.port);
      peakBytes = Math.max(peakBytes, stats.queuedBytes + stats.inFlightBytes);
      return stats;
    };
    const full = await sample();
    const behindSilent = child.lines().length;
    check(preconditions, behindSilent === 0, `${behindSilent} lines reached the reader before its window ended`);
    check(
      preconditions,
      (full.dropped.queue_full ?? 0) > 0,
      `the flood did not reach the 1 MiB cap: ${JSON.stringify(full.dropped)} dropped`,
    );
    const drainDeadline = Date.now() + silentMs + 30_000;
    let last = full;
    while (Date.now() < drainDeadline && (last.queued > 0 || last.inFlight > 0)) {
      // biome-ignore lint/performance/noAwaitInLoops: the stats are sampled in turn while the reader drains
      await delay(100);
      last = await sample();
    }
    const reachedAll = await untilLines(child, last.written, 15_000);
    await delay(300);
    const final = await sample();
    const observed = observeLines(child);
    const problems = [...preconditions, ...observed.problems];
    check(
      problems,
      final.queued === 0 && final.inFlight === 0,
      `${final.queued} queued and ${final.inFlight} in flight after the drain`,
    );
    check(problems, reachedAll, `only ${child.lines().length} of ${last.written} written records reached the reader`);
    check(
      problems,
      observed.lines === final.written,
      `${observed.lines} lines read but the stats count ${final.written} written`,
    );
    check(
      problems,
      final.created === final.written + droppedTotal(final) + final.queued + final.inFlight,
      `created ${final.created} is not written ${final.written} plus dropped ${droppedTotal(final)}`,
    );
    check(problems, observed.nearBound >= 10, `only ${observed.nearBound} lines within 200 bytes of the bound`);
    check(problems, peakBytes <= queueCap, `the queue peaked at ${peakBytes} bytes, over 1 MiB`);
    report.result(
      'AC-2 ceiling: 1 MiB queue of records at the 8,192-byte bound, then the reader drains; every line checked',
      problems,
      `${observed.lines} lines read after the drain, longest ${observed.maxBytes} bytes, ${observed.nearBound} within 200 bytes of the bound, ${droppedTotal(final)} dropped (${final.dropped.queue_full ?? 0} at the cap), ${full.queuedBytes + full.inFlightBytes} bytes held behind the silent reader, queue peak ${peakBytes} of ${queueCap} bytes, 0 lines before the window ended`,
    );
  } finally {
    await child.stop();
  }
}

async function main(): Promise<void> {
  const report = createReport();
  await hostileRun(report);
  await ceilingRun(report);
  report.finish();
}

if (process.argv[2] === 'serve') {
  serve();
} else {
  await main();
}
