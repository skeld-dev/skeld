import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { RouteDefinition, RouteInfo } from '../../contract/types.ts';
import { compileCheck } from '../../schema/check.ts';
import { explain } from '../../schema/explain.ts';
import { isModelSchema, type ModelSchema } from '../../schema/node.ts';
import { toPointer } from '../../schema/pointer.ts';
import type { Schema } from '../../schema/types.ts';
import type { HeaderValue } from '../empty.ts';
import { config } from './config.ts';
import { counter, keyedCounter } from './counts.ts';
import { raise } from './events.ts';
import { type ResponseCheck, routeRecord } from './routes.ts';
import { type SlotRecord, state } from './slots.ts';

const STACK_FRAME = /\bat (?:async )?(?:[^\s()"]+ \()?(?:file:\/\/|node:|\/|[A-Za-z]:\\{1,2})[^\s()"]*:\d+:\d+\)?/;
const ERROR_PREFIX = /"(?:[A-Z][A-Za-z]*)?Error: /;
const LINE_BREAK = /[\r\n]/;
const SUSPICIOUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const STDERR_PREFIXES: readonly (readonly [string, string])[] = [
  ['Response already sent', 'already_sent'],
  ['onResponse hook threw: ', 'on_response'],
  ['onError hook threw: ', 'on_error'],
];

const cwd = process.cwd();
const fileMarkers: readonly string[] = [
  ...(cwd.length > 1 ? [cwd] : []),
  fileURLToPath(new URL('../../../', import.meta.url)),
  'node:internal/',
  '/node_modules/',
  'file:///',
];
const decoder = new TextDecoder();
const canaryStderr = counter('canary.stderr');

export function declareRoute(info: RouteInfo, definition: RouteDefinition): void {
  const route = routeRecord(info);
  for (const [status, schema] of Object.entries(definition.responses)) {
    route.validators.set(Number(status), schema === null ? null : { schema, check: compileCheck(schema) });
  }
}

const asText = (payload: string | Uint8Array): string =>
  typeof payload === 'string' ? payload : decoder.decode(payload);

function unwrapped(schema: Schema): ModelSchema | null {
  let current = schema;
  while (isModelSchema(current)) {
    if (current.kind !== 'optional' && current.kind !== 'exposed') {
      return current;
    }
    current = current.inner;
  }
  return null;
}

function declaredSegments(schema: Schema, path: readonly (string | number)[]): (string | number)[] {
  const kept: (string | number)[] = [];
  let current = schema;
  for (const segment of path) {
    const step = unwrapped(current);
    let next: Schema | undefined;
    if (step?.kind === 'object' && typeof segment === 'string' && Object.hasOwn(step.properties, segment)) {
      next = step.properties[segment];
    } else if (step?.kind === 'array' && typeof segment === 'number') {
      next = step.items;
    }
    if (next === undefined) {
      return kept;
    }
    kept.push(segment);
    current = next;
  }
  return kept;
}

function schemaFailure(validator: ResponseCheck, payload: string | Uint8Array): string | null {
  let value: unknown;
  try {
    value = JSON.parse(asText(payload));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return 'not_json';
    }
    throw error;
  }
  if (validator.check(value)) {
    return null;
  }
  const first = explain(validator.schema, value, 1)[0];
  const pointer = toPointer(declaredSegments(validator.schema, first?.path ?? []));
  return pointer === '' ? '/' : pointer;
}

export function checkPayload(status: number, serialized: string, final: string | Uint8Array): void {
  const record = state.current;
  if (record === null) {
    return;
  }
  const replaced = serialized !== final;
  if (replaced) {
    record.replaced = true;
  }
  const { route } = record;
  if (route === null || record.schemaChecked || !(replaced || record.step)) {
    return;
  }
  const validator = route.validators.get(status);
  if (validator === undefined || validator === null) {
    return;
  }
  record.schemaChecked = true;
  const subject = schemaFailure(validator, final);
  if (subject !== null) {
    raise('leak.response_schema', subject, route.name, status);
  }
}

function valueHasBreak(value: HeaderValue): boolean {
  if (typeof value === 'number') {
    return false;
  }
  return typeof value === 'string' ? LINE_BREAK.test(value) : value.some((item) => LINE_BREAK.test(item));
}

export function checkHeader(name: string, value: HeaderValue): void {
  const badName = LINE_BREAK.test(name);
  if (badName || valueHasBreak(value)) {
    raise('leak.header_injection', badName ? 'name' : name, state.current?.route?.name ?? null, null);
  }
}

function internalText(text: string, url: string): string | null {
  const frame = STACK_FRAME.exec(text);
  if (frame !== null && !url.includes(frame[0])) {
    return 'stack_frame';
  }
  for (const marker of fileMarkers) {
    if (text.includes(marker) && !url.includes(marker)) {
      return 'file_path';
    }
  }
  const prefix = ERROR_PREFIX.exec(text);
  return prefix !== null && !url.includes(prefix[0]) ? 'error_prefix' : null;
}

function hasContentType(headers: OutgoingHttpHeaders | null, res: ServerResponse | null): boolean {
  if (res?.hasHeader('content-type')) {
    return true;
  }
  if (headers === null) {
    return false;
  }
  if (headers['content-type'] !== undefined) {
    return true;
  }
  return Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
}

function carries(value: unknown, token: string): boolean {
  if (typeof value === 'string') {
    return value.includes(token);
  }
  if (typeof value === 'number') {
    return String(value).includes(token);
  }
  return Array.isArray(value) && value.some((item) => carries(item, token));
}

function headersCarry(headers: OutgoingHttpHeaders | null, res: ServerResponse | null, token: string): boolean {
  const written = headers === null ? [] : Object.values(headers);
  const set = res === null ? [] : Object.values(res.getHeaders());
  return [...written, ...set].some((value) => carries(value, token));
}

export function checkWrite(
  record: SlotRecord,
  status: number,
  headers: OutgoingHttpHeaders | null,
  payload: string | Uint8Array | null,
): void {
  const route = record.route?.name ?? null;
  const { canary } = config;
  if (payload !== null) {
    const text = asText(payload);
    const internal = status >= 400 || record.replaced || record.step ? internalText(text, record.req?.url ?? '') : null;
    if (internal !== null) {
      raise('leak.internal_text', internal, route, status);
    }
    if (!hasContentType(headers, record.res)) {
      raise('leak.content_type', null, route, status);
    }
    if (canary !== null && text.includes(canary)) {
      raise('leak.canary', 'wire', route, status);
      return;
    }
  }
  if (canary !== null && headersCarry(headers, record.res, canary)) {
    raise('leak.canary', 'wire', route, status);
  }
}

export function checkKey(key: string): void {
  if (SUSPICIOUS_KEYS.has(key)) {
    keyedCounter('ingress.suspicious_key', key).total += 1;
  }
}

export function checkStderr(line: string): void {
  const found = STDERR_PREFIXES.find(([marker]) => line.includes(marker));
  keyedCounter('err.stderr', found === undefined ? 'thrown' : found[1]).total += 1;
  if (config.canary !== null && line.includes(config.canary)) {
    canaryStderr.total += 1;
  }
}
