// Does:  Proves that the generated check and the closure check agree on verdicts and on failure paths.
// Holds: Zero mismatches is the only passing result.

// biome-ignore lint/correctness/noUnresolvedImports: the seam carries only the skeld-source condition, which Biome's resolver does not set (ADR-028)
import { generateCheck } from '@skeld/core/generated-check';
import * as t from '@skeld/core/schema';
import type { Case } from './corpus.ts';
import { corpus, describeSpec, valueCount } from './corpus.ts';
import type { Json } from './diverse-fixture.ts';

const defaultSchemas = 4000;
const defaultSeed = 20261110;
const httpSchemas = 200;
const batchSize = 40;
const maxPrinted = 10;
const wireCap = 100;

type Kind = 'verdict' | 'explain' | 'valid-refused' | 'threw' | 'status' | 'paths' | 'c02';

interface Mismatch {
  readonly kind: Kind;
  readonly seed: number;
  readonly index: number;
  readonly position: number;
  readonly category: string;
  readonly generated?: unknown;
  readonly closure?: unknown;
  readonly spec: string;
  readonly value: string;
}

interface Options {
  readonly schemas: number;
  readonly seed: number;
  readonly only: 1 | 2 | null;
}

interface Tally {
  readonly name: string;
  readonly schemas: number;
  readonly pairs: number;
  readonly seconds: number;
  readonly mismatches: readonly Mismatch[];
  readonly extra: Readonly<Record<string, number>>;
}

function usage(message: string): never {
  process.stderr.write(`${message}\nusage: differential.ts [--schemas <n>] [--seed <n>] [--only <1|2>]\n`);
  process.exit(2);
}

function readInteger(flag: string, text: string | undefined): number {
  const parsed = Number(text);
  if (text === undefined || !Number.isSafeInteger(parsed) || parsed < 1) {
    return usage(`${flag} needs a positive integer`);
  }
  return parsed;
}

function parseOptions(argv: readonly string[]): Options {
  let schemas = defaultSchemas;
  let seed = defaultSeed;
  let only: 1 | 2 | null = null;
  for (let position = 0; position < argv.length; position += 2) {
    const flag = argv[position];
    const text = argv[position + 1];
    if (flag === '--schemas') {
      schemas = readInteger(flag, text);
    } else if (flag === '--seed') {
      seed = readInteger(flag, text);
    } else if (flag === '--only' && (text === '1' || text === '2')) {
      only = text === '1' ? 1 : 2;
    } else {
      return usage(`unknown argument ${flag ?? ''}`);
    }
  }
  return { schemas, seed, only };
}

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}...(${text.length} chars)` : text;
}

function record(kind: Kind, current: Case, position: number, extra: Partial<Mismatch>): Mismatch {
  const held = current.values[position];
  return {
    kind,
    seed: current.seed,
    index: current.index,
    position,
    category: held?.category ?? 'none',
    spec: clip(describeSpec(current.spec), 600),
    value: clip(JSON.stringify(held?.value), 400),
    ...extra,
  };
}

function isFallbackIssue(issues: readonly { readonly message: string; readonly path: readonly unknown[] }[]): boolean {
  const only = issues[0];
  return issues.length === 1 && only !== undefined && only.path.length === 0 && only.message === 'is not allowed';
}

function compareOne(current: Case, position: number, value: Json, generated: (input: unknown) => boolean): Mismatch[] {
  const found: Mismatch[] = [];
  const answer = current.schema['~standard'].validate(value);
  const closure = 'value' in answer;
  let generatedVerdict: boolean;
  try {
    generatedVerdict = generated(value);
  } catch (error) {
    return [record('threw', current, position, { generated: String(error) })];
  }
  if (generatedVerdict !== closure) {
    found.push(record('verdict', current, position, { generated: generatedVerdict, closure }));
  }
  if ('issues' in answer && (answer.issues.length === 0 || isFallbackIssue(answer.issues))) {
    found.push(record('explain', current, position, { closure: answer.issues }));
  }
  if (current.values[position]?.category === 'valid' && !closure) {
    found.push(record('valid-refused', current, position, { closure: 'issues' in answer ? answer.issues : null }));
  }
  return found;
}

function runClosureAgainstGenerated(options: Options): Tally {
  const started = performance.now();
  const mismatches: Mismatch[] = [];
  let schemas = 0;
  let pairs = 0;
  let accepted = 0;
  for (const current of corpus(options.seed, options.schemas)) {
    schemas++;
    let generated: (input: unknown) => boolean;
    try {
      generated = generateCheck(current.schema);
    } catch (error) {
      mismatches.push(record('threw', current, 0, { generated: String(error) }));
      continue;
    }
    current.values.forEach((held, position) => {
      pairs++;
      if ('value' in current.schema['~standard'].validate(held.value)) {
        accepted++;
      }
      mismatches.push(...compareOne(current, position, held.value, generated));
    });
  }
  const seconds = (performance.now() - started) / 1000;
  return {
    name: 'sub-run 1: generated check against the closure evaluator',
    schemas,
    pairs,
    seconds,
    mismatches,
    extra: { accepted, refused: pairs - accepted },
  };
}

function pointerOf(path: readonly (string | number)[]): string {
  return path.map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

function isObjectJson(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detailPaths(body: unknown): readonly string[] | null {
  if (!isObjectJson(body) || !Array.isArray(body.details)) {
    return null;
  }
  const paths: string[] = [];
  for (const detail of body.details) {
    if (!isObjectJson(detail) || typeof detail.path !== 'string') {
      return null;
    }
    paths.push(detail.path);
  }
  return paths;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
}

interface Exchange {
  readonly current: Case;
  readonly position: number;
  readonly status: number;
  readonly body: unknown;
}

function holdsRefusedKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(holdsRefusedKey);
  }
  if (!isObjectJson(value)) {
    return false;
  }
  const poisonsConstructor =
    Object.hasOwn(value, 'constructor') &&
    isObjectJson(value.constructor) &&
    Object.hasOwn(value.constructor, 'prototype');
  return Object.hasOwn(value, '__proto__') || poisonsConstructor || Object.values(value).some(holdsRefusedKey);
}

function judgeRefused(exchange: Exchange): Mismatch[] {
  const { current, position, status, body } = exchange;
  const code = isObjectJson(body) ? body.code : undefined;
  const hasDetails = isObjectJson(body) && body.details !== undefined;
  if (status === 400 && code === 'BAD_REQUEST' && !hasDetails) {
    return [];
  }
  return [
    record('c02', current, position, {
      generated: { status, code, hasDetails },
      closure: '400 BAD_REQUEST without details',
    }),
  ];
}

function judgeExchange(exchange: Exchange): Mismatch[] {
  const { current, position, status, body } = exchange;
  const held = current.values[position];
  if (held === undefined) {
    return [];
  }
  if (holdsRefusedKey(held.value)) {
    return judgeRefused(exchange);
  }
  const answer = current.schema['~standard'].validate(held.value);
  if ('value' in answer) {
    return status === 200 ? [] : [record('status', current, position, { generated: status, closure: 200 })];
  }
  if (status !== 400) {
    return [record('status', current, position, { generated: status, closure: 400 })];
  }
  const wire = detailPaths(body);
  const expected = answer.issues.slice(0, wireCap).map((issue) => `/body${pointerOf(issue.path)}`);
  if (wire === null || !sameSet(wire, expected)) {
    return [record('paths', current, position, { generated: wire, closure: expected })];
  }
  return [];
}

async function post(url: string, current: Case, position: number): Promise<Exchange> {
  const held = current.values[position];
  const response = await fetch(`${url}/r${current.index}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(held?.value),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { current, position, status: response.status, body };
}

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const batch = items.slice(0, batchSize);
  if (batch.length === 0) {
    return [];
  }
  const done = await Promise.all(batch.map(work));
  return [...done, ...(await inBatches(items.slice(batchSize), work))];
}

async function runOverHttp(options: Options): Promise<Tally> {
  const started = performance.now();
  const [{ defineContract }, { createServer }] = await Promise.all([
    import('@skeld/core/contract'),
    import('@skeld/core/server'),
  ]);
  const chosen = [...corpus(options.seed, Math.min(httpSchemas, options.schemas))];
  const acknowledgement = t.object({ ok: t.boolean() });
  const contract = defineContract(
    Object.fromEntries(
      chosen.map((current) => [
        `r${current.index}`,
        { method: 'POST', path: `/r${current.index}`, body: current.schema, responses: { 200: acknowledgement } },
      ]),
    ),
  );
  const server = createServer();
  server.routes(
    contract,
    Object.fromEntries(Object.keys(contract).map((name) => [name, () => ({ status: 200, body: { ok: true } })])),
  );
  const { url } = await server.listen({ port: 0, host: '127.0.0.1' });
  try {
    const jobs = chosen.flatMap((current) => current.values.map((_, position) => ({ current, position })));
    const exchanges = await inBatches(jobs, (job) => post(url, job.current, job.position));
    const mismatches = exchanges.flatMap(judgeExchange);
    const invalid = exchanges.filter((exchange) => exchange.status === 400).length;
    return {
      name: 'sub-run 2: HTTP 400 detail paths against the closure issues',
      schemas: chosen.length,
      pairs: exchanges.length,
      seconds: (performance.now() - started) / 1000,
      mismatches,
      extra: {
        answered200: exchanges.filter((exchange) => exchange.status === 200).length,
        answered400: invalid,
        c02: exchanges.filter((exchange) => holdsRefusedKey(exchange.current.values[exchange.position]?.value)).length,
      },
    };
  } finally {
    await server.close();
  }
}

function report(tally: Tally, seed: number): void {
  const line = {
    run: tally.name,
    schemas: tally.schemas,
    valuesPerSchema: valueCount,
    pairs: tally.pairs,
    mismatches: tally.mismatches.length,
    seconds: Number(tally.seconds.toFixed(2)),
    seed,
    ...tally.extra,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function main(argv: readonly string[]): Promise<void> {
  const chosen = parseOptions(argv);
  const tallies: Tally[] = [];
  if (chosen.only !== 2) {
    tallies.push(runClosureAgainstGenerated(chosen));
  }
  if (chosen.only !== 1) {
    tallies.push(await runOverHttp(chosen));
  }
  for (const tally of tallies) {
    report(tally, chosen.seed);
    if (tally.extra.c02 !== undefined) {
      process.stdout.write(`c02 ${tally.extra.c02}\n`);
    }
  }
  if (chosen.only !== null) {
    process.stdout.write(`sub-run ${chosen.only === 1 ? 2 : 1} not run (--only ${chosen.only})\n`);
  }
  const failures = tallies.flatMap((tally) => tally.mismatches);
  if (failures.length > 0) {
    process.stdout.write(`${JSON.stringify(failures.slice(0, maxPrinted), null, 1)}\n`);
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
