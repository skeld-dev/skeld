// Does:  Drives the security scenario against the scenario server and reads what the recorder saw.
// Holds: A step's figures are the difference between the snapshots taken before and after that step alone.

import { Agent, request } from 'node:http';
import { connect } from 'node:net';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BenchError, errorCode } from '../bench-error.ts';
import { host } from '../values.ts';
import type { JournalLine, RecorderFolder, SnapshotLine } from './diag-files.ts';
import { countSnapshotLines, readRecorderFolder } from './diag-files.ts';

export type ScenarioPass = 'clean' | 'planted';

export interface ScenarioPassInput {
  readonly pass: ScenarioPass;
  readonly baseUrl: string;
  readonly port: number;
  readonly diagDir: string;
  readonly token: string;
  readonly progress: (line: string) => void;
}

export interface ScenarioStepResult {
  readonly step: string;
  readonly requests: number;
  readonly expected: Readonly<Record<string, number>>;
  readonly observed: Readonly<Record<string, number>>;
  readonly mismatches: readonly string[];
}

export interface ScenarioFinding {
  readonly kind: string;
  readonly subject: string | null;
  readonly route: string | null;
  readonly where: string;
}

export interface ScenarioPassResult {
  readonly pass: ScenarioPass;
  readonly steps: readonly ScenarioStepResult[];
  readonly findings: readonly ScenarioFinding[];
  readonly plantedDetected: readonly string[];
  readonly plantedMissing: readonly string[];
  readonly warnings: readonly string[];
}

const responseTimeoutMs = 10_000;
const quietGapMs = 5000;
const quietGapLines = 2;
const quietPollMs = 100;
const canaryBodyLimit = 100_000;
const containmentRequests = 10_000;
const containmentSockets = 50;
const blockFirstAfterMs = 200;
const blockSecondAfterMs = 300;
const blockLongMs = 100;
const blockShortMs = 5;
const loopDelayFloorUs = 100_000;
const malformedLines = 20;
const silentConnections = 20;
const hostlessRequests = 5;
const statusLinePattern = /^HTTP\/1\.[01] (\d{3})/;
const padPrefix = '{"hello":"world","pad":"';
const padSuffix = '"}';
const leakNames = [
  'leak.response_schema',
  'leak.internal_text',
  'leak.header_injection',
  'leak.content_type',
  'leak.canary',
];

interface WireResponse {
  readonly status: number | null;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
  readonly bytes: Buffer;
  readonly failure: string | null;
  readonly timedOut: boolean;
}

interface Expectation {
  readonly method: string;
  readonly target: string;
  readonly route: string | null;
  readonly status: number | null;
  readonly carriesToken: boolean;
  readonly check: ((response: WireResponse) => string | null) | null;
}

interface WireCall extends Expectation {
  readonly bytes: Buffer | null;
}

interface PassState {
  readonly input: ScenarioPassInput;
  readonly where: string;
  readonly findings: ScenarioFinding[];
}

interface StepWindow {
  readonly from: SnapshotLine;
  readonly to: SnapshotLine;
  readonly snapshots: readonly SnapshotLine[];
  readonly journal: readonly JournalLine[];
}

interface Figure {
  readonly name: string;
  readonly atLeast: boolean;
  readonly expected: (window: StepWindow) => number | null;
  readonly observed: (window: StepWindow) => number | null;
}

interface Step {
  readonly name: string;
  readonly send: (state: PassState, step: string) => Promise<number>;
  readonly figures: readonly Figure[];
}

interface PlantedLeak {
  readonly kind: string;
  readonly figure: Figure;
}

const head = (lines: readonly string[]): string => `${lines.join('\r\n')}\r\n\r\n`;

const hostLine = `host: ${host}`;

const get = (target: string, route: string | null, status: number, check: WireCall['check'] = null): WireCall => ({
  method: 'GET',
  target,
  route,
  status,
  carriesToken: false,
  check,
  bytes: Buffer.from(head([`GET ${target} HTTP/1.1`, hostLine, 'connection: close'])),
});

const post = (body: string, status: number, mediaType = 'application/json'): WireCall => ({
  method: 'POST',
  target: '/canary/body',
  route: 'canary_body',
  status,
  carriesToken: false,
  check: null,
  bytes: Buffer.from(
    `${head([
      'POST /canary/body HTTP/1.1',
      hostLine,
      `content-type: ${mediaType}`,
      `content-length: ${Buffer.byteLength(body)}`,
      'connection: close',
    ])}${body}`,
  ),
});

const raw = (method: string, target: string, lines: readonly string[] | null, status: number | null): WireCall => ({
  method,
  target,
  route: null,
  status,
  carriesToken: false,
  check: null,
  bytes: lines === null ? null : Buffer.from(head(lines), 'latin1'),
});

const padded = (bytes: number): string =>
  `${padPrefix}${'a'.repeat(bytes - padPrefix.length - padSuffix.length)}${padSuffix}`;

const repeat = <T>(count: number, value: T): readonly T[] => Array.from({ length: count }, () => value);

function internalBody(response: WireResponse): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return 'with a body that is not JSON';
    }
    throw error;
  }
  return typeof parsed === 'object' && parsed !== null && 'code' in parsed && parsed.code === 'INTERNAL'
    ? null
    : 'without code INTERNAL';
}

const servedAsDeclared = (response: WireResponse): string | null =>
  response.body === '{"hello":"world"}' ? null : 'with a body other than the serialized contract body';

const noContentType = (response: WireResponse): string | null =>
  response.headers.has('content-type') ? 'with a content-type' : null;

function parseResponse(bytes: Buffer, failure: string | null, timedOut: boolean): WireResponse {
  const split = bytes.indexOf('\r\n\r\n');
  const headText = bytes.toString('latin1', 0, split === -1 ? bytes.length : split);
  const [statusLine = '', ...headerLines] = headText.split('\r\n');
  const match = statusLinePattern.exec(statusLine);
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  const rest = split === -1 ? Buffer.alloc(0) : bytes.subarray(split + 4);
  const length = Number(headers.get('content-length'));
  const body = Number.isSafeInteger(length) && length <= rest.length ? rest.subarray(0, length) : rest;
  return {
    status: match?.[1] === undefined ? null : Number(match[1]),
    headers,
    body: body.toString('utf8'),
    bytes,
    failure,
    timedOut,
  };
}

function rawExchange(port: number, bytes: Buffer | null): Promise<WireResponse> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    let failure: string | null = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      socket.destroy();
    }, responseTimeoutMs);
    socket.on('connect', () => {
      if (bytes === null) {
        socket.end();
      } else {
        socket.write(bytes);
      }
    });
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.on('error', (error) => {
      failure = errorCode(error) ?? error.message;
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(parseResponse(Buffer.concat(chunks), failure, timedOut));
    });
  });
}

function agentGet(agent: Agent, port: number, path: string): Promise<WireResponse> {
  return new Promise((resolve) => {
    let timedOut = false;
    const answer = (status: number | null, bytes: Buffer, failure: string | null): void => {
      resolve({ status, headers: new Map(), body: '', bytes, failure, timedOut });
    };
    const outgoing = request({ host, port, path, method: 'GET', agent }, (incoming) => {
      const chunks: Buffer[] = [Buffer.from(incoming.rawHeaders.join('\n'))];
      incoming.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      incoming.on('end', () => {
        answer(incoming.statusCode ?? null, Buffer.concat(chunks), null);
      });
      incoming.on('error', (error) => {
        answer(null, Buffer.concat(chunks), errorCode(error) ?? error.message);
      });
    });
    outgoing.setTimeout(responseTimeoutMs, () => {
      timedOut = true;
      outgoing.destroy();
    });
    outgoing.on('error', (error) => {
      answer(null, Buffer.alloc(0), errorCode(error) ?? error.message);
    });
    outgoing.end();
  });
}

function describeAnswer(response: WireResponse): string {
  if (response.timedOut) {
    return `no response within ${responseTimeoutMs / 1000} s`;
  }
  if (response.status !== null) {
    return String(response.status);
  }
  return response.failure === null ? 'no response' : `no response (${response.failure})`;
}

const stepFailure = (step: string, expect: Expectation, got: string): BenchError =>
  new BenchError(
    4,
    `scenario step ${step} expected ${expect.status ?? 'no answer'} from ${expect.method} ${expect.target}, got ${got}; the scenario no longer exercises what it claims.`,
  );

function judge(state: PassState, step: string, expect: Expectation, response: WireResponse): void {
  const carries = response.bytes.includes(state.input.token);
  if (carries && !expect.carriesToken) {
    state.findings.push({ kind: 'wire_token', subject: step, route: expect.route, where: 'wire' });
  }
  if (response.timedOut || response.status !== expect.status) {
    throw stepFailure(step, expect, describeAnswer(response));
  }
  const problem = expect.carriesToken && !carries ? 'without the planted token' : (expect.check?.(response) ?? null);
  if (problem !== null) {
    throw stepFailure(step, expect, `${describeAnswer(response)} ${problem}`);
  }
}

async function sendCalls(state: PassState, step: string, calls: readonly WireCall[]): Promise<number> {
  for (const call of calls) {
    // biome-ignore lint/performance/noAwaitInLoops: one request at a time on a fresh connection, in the order the step fixes.
    const response = await rawExchange(state.input.port, call.bytes);
    judge(state, step, call, response);
  }
  return calls.length;
}

const callsStep = (name: string, calls: readonly WireCall[], figures: readonly Figure[]): Step => ({
  name,
  send: (state, step) => sendCalls(state, step, calls),
  figures,
});

const total = (line: SnapshotLine, name: string): number => line.counts[name] ?? line.events[name]?.run_n ?? 0;

const keyedTotal = (line: SnapshotLine, name: string): number =>
  Object.entries(line.counts).reduce((sum, [key, value]) => (key.startsWith(`${name}{`) ? sum + value : sum), 0);

const delta = (name: string, expected: number, atLeast = false): Figure => ({
  name,
  atLeast,
  expected: () => expected,
  observed: ({ from, to }) => total(to, name) - total(from, name),
});

const keyedDelta = (name: string, expected: number): Figure => ({
  name,
  atLeast: false,
  expected: () => expected,
  observed: ({ from, to }) => keyedTotal(to, name) - keyedTotal(from, name),
});

const journaled = (name: string, expected: number, match: (line: JournalLine) => boolean): Figure => ({
  name,
  atLeast: false,
  expected: () => expected,
  observed: ({ journal }) => journal.filter(match).length,
});

const headroomLow = (expected: number): Figure =>
  journaled(
    'limit.body_bytes{headroom_low}',
    expected,
    (line) => line.hook === 'limit.body_bytes' && line.subject === 'headroom_low',
  );

function listenersField(line: SnapshotLine, field: string): number | null {
  const gauge = line.gauges['contain.listeners'];
  if (typeof gauge !== 'object' || gauge === null) {
    return null;
  }
  const value: unknown = Reflect.get(gauge, field);
  return typeof value === 'number' ? value : null;
}

const listeners = (field: string): Figure => ({
  name: `contain.listeners{${field}}`,
  atLeast: false,
  expected: ({ from }) => listenersField(from, field),
  observed: ({ to }) => listenersField(to, field),
});

const loopDelayMax: Figure = {
  name: 'loop.delay{max_us}',
  atLeast: true,
  expected: () => loopDelayFloorUs,
  observed: ({ snapshots }) =>
    snapshots.length === 0 ? null : Math.max(...snapshots.map((line) => line.process['loop.delay'].max_us)),
};

const egressZero: readonly Figure[] = [...leakNames, 'contain.raw_request'].map((name) => delta(name, 0));

const helloExpectation: Expectation = {
  method: 'GET',
  target: '/hello',
  route: 'hello',
  status: 200,
  carriesToken: false,
  check: null,
};

const blockCall = (ms: number): WireCall => get(`/block?ms=${ms}`, 'block', 200);

async function helloLoop(state: PassState, step: string, agent: Agent, running: () => boolean): Promise<number> {
  let sent = 0;
  while (running()) {
    // biome-ignore lint/performance/noAwaitInLoops: the keep-alive loop sends the next request only after the last answer.
    const response = await agentGet(agent, state.input.port, '/hello');
    judge(state, step, helloExpectation, response);
    sent++;
  }
  return sent;
}

async function sendBlock(state: PassState, step: string): Promise<number> {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  let running = true;
  const loop = helloLoop(state, step, agent, () => running).then(
    (sent) => ({ sent, error: null }),
    (error: unknown) => ({ sent: 0, error }),
  );
  const long = blockCall(blockLongMs);
  const short = blockCall(blockShortMs);
  await delay(blockFirstAfterMs);
  const longAnswer = rawExchange(state.input.port, long.bytes);
  await delay(blockSecondAfterMs);
  const shortAnswer = rawExchange(state.input.port, short.bytes);
  const [longResponse, shortResponse] = await Promise.all([longAnswer, shortAnswer]);
  running = false;
  const looped = await loop;
  agent.destroy();
  if (looped.error !== null) {
    throw looped.error;
  }
  judge(state, step, long, longResponse);
  judge(state, step, short, shortResponse);
  return looped.sent + 2;
}

async function sendContainment(state: PassState, step: string): Promise<number> {
  const agent = new Agent({ keepAlive: true, maxSockets: containmentSockets });
  let remaining = containmentRequests;
  const worker = async (): Promise<void> => {
    while (remaining > 0) {
      remaining--;
      // biome-ignore lint/performance/noAwaitInLoops: each of the 50 workers keeps one request in flight; together they hold 50.
      const response = await agentGet(agent, state.input.port, '/hello');
      judge(state, step, helloExpectation, response);
    }
  };
  try {
    await Promise.all(Array.from({ length: containmentSockets }, worker));
  } finally {
    agent.destroy();
  }
  return containmentRequests;
}

function cleanSteps(token: string): readonly Step[] {
  const internal = get('/canary/throw', 'canary_throw', 500, internalBody);
  return [
    callsStep(
      'limit-alarm',
      [96_000, 96_000, 50_000, 96_000].map((bytes) => post(padded(bytes), 200)),
      [headroomLow(2), delta('ingress.near_limit{body_bytes}', 3)],
    ),
    callsStep(
      'near-limit',
      [
        ...repeat(10, post(padded(50_000), 200)),
        ...repeat(10, post(padded(85_000), 200)),
        ...repeat(3, post('{"hello":"x","constructor":"plain"}', 200)),
      ],
      [
        delta('ingress.near_limit{body_bytes}', 10),
        delta('ingress.suspicious_key{constructor}', 3),
        delta('refuse.forbidden_key', 0),
        headroomLow(0),
      ],
    ),
    callsStep(
      'egress',
      [
        ...repeat(3, internal),
        ...repeat(3, get('/canary/field', 'canary_field', 200)),
        ...repeat(3, post(`{"hello":"${token}"}`, 200)),
        post(`{"hello":{"note":"${token}"}}`, 400),
        post(`{"hello":"x","note":"${token}"}`, 400),
        post(`{"hello":"${token}`, 400),
        post(`{"hello":"x","__proto__":{"note":"${token}"}}`, 400),
        post(`${token}${'a'.repeat(canaryBodyLimit + 1 - token.length)}`, 413),
        get('/empty', 'empty', 204, noContentType),
        get('/hello', 'hello', 200),
      ],
      [
        delta('err.internal', 3),
        delta('refuse.validation', 2),
        delta('refuse.body_json', 1),
        delta('refuse.forbidden_key', 1),
        delta('refuse.body_limit', 1),
        delta('ingress.suspicious_key{__proto__}', 1),
        ...egressZero,
      ],
    ),
    callsStep(
      'refusals',
      [
        raw('GET', '/hello', ['GET /hello HTTP/1.1', hostLine, hostLine, 'connection: close'], 400),
        get('/missing', null, 404),
        post(padded(canaryBodyLimit + 1), 413),
        post('{"hello":"world"}', 415, 'application/xml'),
        internal,
      ],
      [
        delta('refuse.framing', 1),
        delta('refuse.not_found{GET}', 1),
        delta('refuse.body_limit', 1),
        delta('refuse.media_type', 1),
        delta('err.internal', 1),
        ...[400, 404, 413, 415, 500].map((status) => delta(`req.status{${status}}`, 1)),
      ],
    ),
    callsStep(
      'below-floor',
      [
        ...repeat(malformedLines, raw('GET', '/\\x01', ['GET /\x01 HTTP/1.1', hostLine], 400)),
        ...repeat(silentConnections, raw('a connection', 'that sends nothing', null, null)),
        ...repeat(
          hostlessRequests,
          raw('GET', '/hello without host', ['GET /hello HTTP/1.1', 'connection: close'], 400),
        ),
      ],
      [
        delta('refuse.below_floor', malformedLines + silentConnections),
        delta('refuse.node_answered', hostlessRequests),
        keyedDelta('req.count', 0),
      ],
    ),
    {
      name: 'block',
      send: sendBlock,
      figures: [
        journaled('loop.block{block}', 1, (line) => line.hook === 'loop.block' && line.route === 'block'),
        loopDelayMax,
      ],
    },
    {
      name: 'containment',
      send: sendContainment,
      figures: [
        ...['server_request', 'sockets_open', 'inflight', 'socket_listeners_peak'].map(listeners),
        delta('contain.listeners', 0),
        delta('contain.raw_request', 0),
      ],
    },
  ];
}

const plantedLeaks: readonly PlantedLeak[] = [
  { kind: 'leak.canary', figure: delta('leak.canary', 1, true) },
  {
    kind: 'leak.header_injection',
    figure: journaled(
      'leak.header_injection{x-scenario-note}',
      1,
      (line) => line.hook === 'leak.header_injection' && line.subject === 'x-scenario-note',
    ),
  },
  {
    kind: 'leak.content_type',
    figure: journaled(
      'leak.content_type{plant_raw}',
      1,
      (line) => line.hook === 'leak.content_type' && line.route === 'plant_raw',
    ),
  },
];

const plantedSteps: readonly Step[] = [
  callsStep(
    'planted',
    [
      get('/plant/send', 'plant_send', 200, servedAsDeclared),
      get('/plant/header', 'plant_header', 500),
      { ...get('/plant/raw', 'plant_raw', 200, noContentType), carriesToken: true },
    ],
    plantedLeaks.map((leak) => leak.figure),
  ),
];

async function quietGap(state: PassState, step: string): Promise<RecorderFolder> {
  const folder = state.input.diagDir;
  const target = countSnapshotLines(folder) + quietGapLines;
  const deadline = performance.now() + quietGapMs;
  while (countSnapshotLines(folder) < target) {
    if (performance.now() >= deadline) {
      throw new BenchError(
        4,
        `scenario step ${step} waited ${quietGapMs / 1000} s for ${quietGapLines} more lines in ${folder}/snapshot.jsonl; the recorder stopped writing.`,
      );
    }
    // biome-ignore lint/performance/noAwaitInLoops: the gap polls the file until the recorder has written two more windows.
    await delay(quietPollMs);
  }
  return readRecorderFolder(folder);
}

function lastSnapshot(folder: RecorderFolder, step: string): SnapshotLine {
  const line = folder.snapshots.at(-1);
  if (line === undefined) {
    throw new BenchError(4, `scenario step ${step} found no line in ${folder.folder}/snapshot.jsonl.`);
  }
  return line;
}

const windowOf = (folder: RecorderFolder, from: SnapshotLine, to: SnapshotLine): StepWindow => ({
  from,
  to,
  snapshots: folder.snapshots.filter((line) => line.t > from.t && line.t <= to.t),
  journal: folder.journal.filter((line) => line.t > from.t && line.t <= to.t),
});

function measure(step: Step, requests: number, window: StepWindow): ScenarioStepResult {
  const expected: [string, number][] = [];
  const observed: [string, number][] = [];
  const mismatches: string[] = [];
  for (const figure of step.figures) {
    const want = figure.expected(window);
    const got = figure.observed(window);
    if (want !== null) {
      expected.push([figure.name, want]);
    }
    if (got !== null) {
      observed.push([figure.name, got]);
    }
    if (want === null || got === null || (figure.atLeast ? got < want : got !== want)) {
      mismatches.push(
        `${figure.name} expected ${figure.atLeast ? 'at least ' : ''}${want ?? 'a value'}, observed ${got ?? 'none'}`,
      );
    }
  }
  return {
    step: step.name,
    requests,
    expected: Object.fromEntries(expected),
    observed: Object.fromEntries(observed),
    mismatches,
  };
}

function outcome(result: ScenarioStepResult): string {
  const differ = result.mismatches.length;
  if (differ === 0) {
    return 'ok';
  }
  return differ === 1 ? 'ok, 1 figure differs' : `ok, ${differ} figures differ`;
}

function recorderFindings(
  state: PassState,
  folder: RecorderFolder,
  last: SnapshotLine,
  allowed: ReadonlySet<string>,
): void {
  const seen = new Set<string>();
  for (const line of folder.journal) {
    if (line.fails_run) {
      seen.add(line.hook);
      if (!allowed.has(line.hook)) {
        const subject = line.subject === null ? null : String(line.subject);
        state.findings.push({ kind: line.hook, subject, route: line.route, where: state.where });
      }
    }
  }
  for (const name of last.failing) {
    if (!(seen.has(name) || allowed.has(name))) {
      state.findings.push({ kind: name, subject: null, route: null, where: state.where });
    }
  }
  if (total(last, 'canary.stderr') > 0) {
    state.findings.push({ kind: 'leak.canary', subject: null, route: null, where: 'stderr' });
  }
}

async function runStep(
  state: PassState,
  step: Step,
  from: SnapshotLine,
): Promise<{ result: ScenarioStepResult; folder: RecorderFolder; to: SnapshotLine }> {
  const { pass, progress } = state.input;
  try {
    const requests = await step.send(state, step.name);
    const folder = await quietGap(state, step.name);
    const to = lastSnapshot(folder, step.name);
    const result = measure(step, requests, windowOf(folder, from, to));
    progress(`[scenario] ${pass} ${step.name} ${requests} requests ${outcome(result)}`);
    return { result, folder, to };
  } catch (error) {
    if (error instanceof BenchError) {
      progress(`[scenario] ${pass} ${step.name} FAILED: ${error.message}`);
    }
    throw error;
  }
}

export async function runScenarioPass(input: ScenarioPassInput): Promise<ScenarioPassResult> {
  const state: PassState = { input, where: basename(input.diagDir), findings: [] };
  await sendCalls(state, 'preflight', [get('/hello', 'hello', 200)]);
  let folder = await quietGap(state, 'preflight');
  let from = lastSnapshot(folder, 'preflight');
  const steps: ScenarioStepResult[] = [];
  for (const step of input.pass === 'clean' ? cleanSteps(input.token) : plantedSteps) {
    // biome-ignore lint/performance/noAwaitInLoops: steps run in order; each one's figures are the snapshot difference across it alone.
    const ran = await runStep(state, step, from);
    steps.push(ran.result);
    folder = ran.folder;
    from = ran.to;
  }
  const planted = input.pass === 'planted' ? plantedLeaks : [];
  recorderFindings(state, folder, from, new Set(planted.map((leak) => leak.kind)));
  const detected = (leak: PlantedLeak): boolean => (steps[0]?.observed[leak.figure.name] ?? 0) >= 1;
  return {
    pass: input.pass,
    steps,
    findings: state.findings,
    plantedDetected: planted.filter(detected).map((leak) => leak.kind),
    plantedMissing: planted.filter((leak) => !detected(leak)).map((leak) => leak.kind),
    warnings: steps.flatMap((step) =>
      step.mismatches.map((mismatch) => `scenario ${input.pass} ${step.step}: ${mismatch}`),
    ),
  };
}
