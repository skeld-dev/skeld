// Does:  Inspects a schema at boot for unbounded fields, invalid bounds and a secret in a response.
// Holds: A secret node in a response is a finding unless an exposed node with a reason stands above it.

import { isModelSchema } from './node.ts';
import type { Finding, Schema, Sensitivity } from './types.ts';

type Report = (code: Finding['code'], message: string) => void;

interface Walk {
  readonly role: 'request' | 'response';
  readonly findings: Finding[];
}

function escapeKey(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

// Why: A bad bound is described by its type unless it is a number, so no arbitrary value is echoed.
function render(value: unknown): string {
  return typeof value === 'number' ? String(value) : typeof value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function bounded(report: Report, noun: string, limit: string, value: unknown, unbounded: unknown): void {
  if (value === undefined && unbounded === undefined) {
    report('UNBOUNDED_FIELD', `${noun} needs ${limit} or unbounded: '<reason>'`);
  }
}

function count(report: Report, name: string, value: unknown): void {
  if (value !== undefined && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
    report('INVALID_BOUND', `${name} must be a non-negative integer, got ${render(value)}`);
  }
}

function finite(report: Report, name: string, value: unknown): void {
  if (value !== undefined && !isFiniteNumber(value)) {
    report('INVALID_BOUND', `${name} must be a finite number, got ${render(value)}`);
  }
}

function ordered(report: Report, minName: string, min: unknown, maxName: string, max: unknown): void {
  if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
    report('INVALID_BOUND', `${minName} ${String(min)} is above ${maxName} ${String(max)}`);
  }
}

function exclusive(report: Report, limit: string, value: unknown, unbounded: unknown): void {
  if (value !== undefined && unbounded !== undefined) {
    report('INVALID_BOUND', `${limit} and unbounded are both set`);
  }
}

function inspectNode(schema: Schema, pointer: string, exempt: boolean, walk: Walk): void {
  if (!isModelSchema(schema)) {
    return;
  }
  const report: Report = (code, message) => {
    walk.findings.push({ code, pointer, message });
  };
  const secret = (sensitivity: Sensitivity | undefined): void => {
    if (walk.role === 'response' && !exempt && sensitivity === 'secret') {
      report(
        'SECRET_IN_RESPONSE',
        "a secret field is in a response; wrap it in t.exposed(node, '<reason>') or remove it",
      );
    }
  };
  switch (schema.kind) {
    case 'string':
      bounded(report, 'a string', 'maxLength', schema.maxLength, schema.unbounded);
      count(report, 'maxLength', schema.maxLength);
      count(report, 'minLength', schema.minLength);
      ordered(report, 'minLength', schema.minLength, 'maxLength', schema.maxLength);
      exclusive(report, 'maxLength', schema.maxLength, schema.unbounded);
      secret(schema.sensitivity);
      return;
    case 'integer':
    case 'number':
      finite(report, 'minimum', schema.minimum);
      finite(report, 'maximum', schema.maximum);
      ordered(report, 'minimum', schema.minimum, 'maximum', schema.maximum);
      secret(schema.sensitivity);
      return;
    case 'boolean':
    case 'null':
      secret(schema.sensitivity);
      return;
    case 'literal':
      return;
    case 'object':
      count(report, 'minProperties', schema.minProperties);
      secret(schema.sensitivity);
      for (const [key, property] of Object.entries(schema.properties)) {
        inspectNode(property, `${pointer}/properties/${escapeKey(key)}`, exempt, walk);
      }
      return;
    case 'array':
      bounded(report, 'an array', 'maxItems', schema.maxItems, schema.unbounded);
      count(report, 'maxItems', schema.maxItems);
      count(report, 'minItems', schema.minItems);
      ordered(report, 'minItems', schema.minItems, 'maxItems', schema.maxItems);
      exclusive(report, 'maxItems', schema.maxItems, schema.unbounded);
      secret(schema.sensitivity);
      inspectNode(schema.items, `${pointer}/items`, exempt, walk);
      return;
    case 'record':
      bounded(report, 'a record', 'maxProperties', schema.maxProperties, schema.unbounded);
      count(report, 'maxProperties', schema.maxProperties);
      exclusive(report, 'maxProperties', schema.maxProperties, schema.unbounded);
      secret(schema.sensitivity);
      // Why: A record key cannot carry sensitivity (the builder refuses it), so it is never a secret finding.
      inspectNode(schema.key, `${pointer}/propertyNames`, true, walk);
      inspectNode(schema.value, `${pointer}/additionalProperties`, exempt, walk);
      return;
    case 'union':
      secret(schema.sensitivity);
      for (const [index, member] of schema.members.entries()) {
        inspectNode(member, `${pointer}/anyOf/${String(index)}`, exempt, walk);
      }
      return;
    case 'optional':
      inspectNode(schema.inner, pointer, exempt, walk);
      return;
    case 'exposed':
      inspectNode(schema.inner, pointer, true, walk);
      return;
  }
}

export function inspectSchema(schema: Schema, role: 'request' | 'response'): readonly Finding[] {
  const walk: Walk = { role, findings: [] };
  inspectNode(schema, '', false, walk);
  return walk.findings;
}
