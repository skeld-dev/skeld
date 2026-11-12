// Does:  Encodes one record as a single JSON line with the keys of the record format, giving parts up to fit.
// Holds: A line is at most RECORD_BYTES bytes, holds no newline, and fields sit only under the one fields key.

import { escapeText } from './escape.ts';
import { SEVERITY_NUMBER } from './events.ts';
import { ENGINE_UNITS, IDENTIFIER_UNITS, OTHER, RECORD_BYTES, TEXT_UNITS } from './limits.ts';
import type { ErrorPart, RecordParts, RequestLog } from './shapes.ts';

const FIELDS_KEY = '"fields":';
const OMITTED_KEY = '"skeld.omitted":';
const MESSAGE_KEY = '"message":';

// Why: time, the two severities, the event name and the category open every record, then the request id if any.
const ALWAYS_KEPT = 5;

// Does:  A member that can be given up, with its bytes in the line counting the comma before it.
interface Part {
  readonly member: string;
  readonly size: number;
}

// Does:  What is still in the line while parts are given up; size is the line's bytes at every step.
interface Fit {
  readonly keptSize: number;
  readonly fieldSizes: readonly number[];
  fieldCount: number;
  fieldsSize: number;
  readonly losable: (Part | null)[];
  message: Part | null;
  omitted: number;
}

function text(value: string, maxUnits: number): string {
  return `"${escapeText(value, maxUnits)}"`;
}

function finite(value: number): string {
  return Number.isFinite(value) ? String(value) : 'null';
}

function bytes(value: string): number {
  return Buffer.byteLength(value);
}

function requestMembers(request: RequestLog, engine: boolean, members: string[]): void {
  members.push(`"skeld.request_id":${text(request.id, ENGINE_UNITS)}`);
  if (request.traceId !== null && request.traceFlags !== null) {
    members.push(`"trace_id":${text(request.traceId, ENGINE_UNITS)}`);
    members.push(`"trace_flags":${text(request.traceFlags, ENGINE_UNITS)}`);
  }
  if (request.inboundId !== null) {
    members.push(`"http.request.header.x-request-id":[${text(request.inboundId, ENGINE_UNITS)}]`);
  }
  if (!engine) {
    return;
  }
  members.push(`"http.request.method":${text(request.method, ENGINE_UNITS)}`);
  if (request.route !== null) {
    members.push(`"http.route":${text(request.route, ENGINE_UNITS)}`);
  }
  if (request.address !== null) {
    members.push(`"client.address":${text(request.address, ENGINE_UNITS)}`);
  }
}

function errorMembers(error: ErrorPart, members: string[]): void {
  members.push(`"skeld.exception.kind":"${error.kind}"`);
  if (error.type !== null) {
    members.push(`"exception.type":${text(error.type, IDENTIFIER_UNITS)}`);
  }
  if (error.code !== null) {
    members.push(`"skeld.exception.code":${text(error.code, IDENTIFIER_UNITS)}`);
  }
}

// Does:  The members a record keeps whatever its size: each value is cut, so together they fit.
function keptMembers(parts: RecordParts): string[] {
  const members = [
    `"time":"${new Date(parts.timeMs).toISOString()}"`,
    `"severity_text":"${parts.severity}"`,
    `"severity_number":${SEVERITY_NUMBER[parts.severity]}`,
    `"event_name":${text(parts.event, ENGINE_UNITS)}`,
    `"skeld.category":"${parts.category}"`,
  ];
  if (parts.request !== null) {
    requestMembers(parts.request, parts.engine, members);
  }
  if (parts.status !== null) {
    members.push(`"http.response.status_code":${finite(parts.status)}`);
  }
  if (parts.errorType !== null) {
    const type = parts.errorType.length > IDENTIFIER_UNITS ? OTHER : parts.errorType;
    members.push(`"error.type":${text(type, IDENTIFIER_UNITS)}`);
  }
  if (parts.reason !== null) {
    members.push(`"skeld.reason":${text(parts.reason, ENGINE_UNITS)}`);
  }
  if (parts.error !== null) {
    errorMembers(parts.error, members);
  }
  for (const [key, value] of parts.extra ?? []) {
    members.push(`${text(key, ENGINE_UNITS)}:${typeof value === 'number' ? finite(value) : text(value, ENGINE_UNITS)}`);
  }
  return members;
}

function part(member: string): Part {
  return { member, size: bytes(member) + 1 };
}

function optional(key: string, value: string | null, maxUnits: number): Part | null {
  return value === null ? null : part(`"${key}":${text(value, maxUnits)}`);
}

function omittedSize(omitted: number): number {
  return omitted === 0 ? 0 : OMITTED_KEY.length + String(omitted).length + 1;
}

function lineSize(fit: Fit): number {
  let size = fit.keptSize + omittedSize(fit.omitted) + (fit.message?.size ?? 0);
  for (const losable of fit.losable) {
    size += losable?.size ?? 0;
  }
  return fit.fieldCount === 0 ? size : size + fit.fieldsSize;
}

// Does:  The longest cut of the message whose member takes at most room bytes, or null when not even "" fits.
function cutMessage(message: string, room: number): Part | null {
  const fits = (units: number): boolean => bytes(text(message, units)) + MESSAGE_KEY.length + 1 <= room;
  if (!fits(0)) {
    return null;
  }
  let low = 0;
  let high = Math.min(message.length, TEXT_UNITS);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return part(`${MESSAGE_KEY}${text(message, low)}`);
}

// Does:  Gives parts up in order until the line fits: field members from the last, the losable parts, the message.
// Holds: Each part given up adds exactly one to omitted.
function giveUp(fit: Fit, message: string): void {
  while (lineSize(fit) > RECORD_BYTES) {
    const next = fit.losable.findIndex((losable) => losable !== null);
    if (fit.fieldCount > 0) {
      fit.fieldCount -= 1;
      fit.fieldsSize -= fit.fieldSizes[fit.fieldCount] ?? 0;
    } else if (next !== -1) {
      fit.losable[next] = null;
    } else if (fit.message !== null) {
      const others = lineSize(fit) - fit.message.size - omittedSize(fit.omitted);
      fit.message = cutMessage(message, RECORD_BYTES - others - omittedSize(fit.omitted + 1));
    } else {
      return;
    }
    fit.omitted += 1;
  }
}

export function encodeRecord(parts: RecordParts): string {
  const kept = keptMembers(parts);
  const fieldMembers = parts.fields?.members ?? [];
  const fieldSizes = fieldMembers.map((member) => bytes(member) + 1);
  const error = parts.error;
  const fit: Fit = {
    keptSize: bytes(kept.join(',')) + 2,
    fieldSizes,
    fieldCount: fieldMembers.length,
    fieldsSize: fieldSizes.reduce((sum, size) => sum + size, FIELDS_KEY.length + 2),
    // Why: Over the bound these go in this order, after the field members: the frames, the cause, the message.
    losable: [
      optional('exception.stacktrace', error?.frames ?? null, Number.POSITIVE_INFINITY),
      optional('skeld.exception.cause', error?.cause ?? null, TEXT_UNITS),
      optional('exception.message', error?.message ?? null, TEXT_UNITS),
    ],
    message: optional('message', parts.message, TEXT_UNITS),
    omitted: parts.fields?.omitted ?? 0,
  };
  giveUp(fit, parts.message ?? '');
  if (lineSize(fit) > RECORD_BYTES) {
    // Why: Only an engine record with more own keys than any event declares gets here; its opening keys always fit.
    const opening = kept.slice(0, parts.request === null ? ALWAYS_KEPT : ALWAYS_KEPT + 1);
    return `{${[...opening, `${OMITTED_KEY}${fit.omitted + 1}`].join(',')}}`;
  }
  const members = [...kept];
  for (const losable of [fit.message, ...fit.losable]) {
    if (losable !== null) {
      members.push(losable.member);
    }
  }
  if (fit.fieldCount > 0) {
    members.push(`${FIELDS_KEY}{${fieldMembers.slice(0, fit.fieldCount).join(',')}}`);
  }
  if (fit.omitted > 0) {
    members.push(`${OMITTED_KEY}${fit.omitted}`);
  }
  return `{${members.join(',')}}`;
}
