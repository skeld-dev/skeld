// Does:  Emits the JavaScript source of the validation check for a schema.
// Holds: Every declared key and value enters the source through JSON.stringify or String; none is spliced in raw.

import { isModelSchema } from '../schema/node.ts';
import type { ArraySchema, ObjectSchema, RecordSchema, Schema, UnionSchema } from '../schema/types.ts';
import { above, below, exactKeys, fresh, type Names, objectTest, optionalInner, scalarTerms, test } from './terms.ts';

function emitProperty(
  key: string,
  node: Schema,
  value: string,
  fail: string,
  present: string | null,
  names: Names,
): string {
  const quoted = JSON.stringify(key);
  const item = fresh('v', names);
  const inner = optionalInner(node);
  // Why: A declared key that Object.prototype also has would read the inherited member, so hasOwn is tested first.
  const inherited = key in Object.prototype;
  if (inner === null) {
    const own = inherited ? test([`!Object.hasOwn(${value}, ${quoted})`], fail) : '';
    return `${own}const ${item} = ${value}[${quoted}];\n${emitNode(node, item, fail, names)}`;
  }
  const counted = present === null ? '' : `${present}++;\n`;
  const read = `const ${item} = ${value}[${quoted}];\nif (${item} !== undefined) {\n${counted}${emitNode(inner, item, fail, names)}}\n`;
  return inherited ? `if (Object.hasOwn(${value}, ${quoted})) {\n${read}}\n` : read;
}

function emitObject(node: ObjectSchema, value: string, fail: string, names: Names): string {
  const entries = Object.entries(node.properties);
  const required = entries.filter(([, property]) => optionalInner(property) === null).length;
  const closed = node.open === undefined;
  const counted = closed || node.minProperties !== undefined;
  // Why: Optional keys make the key count vary; the counter tells the closed-object walk how many to expect.
  const present = counted && required < entries.length ? fresh('c', names) : null;
  let code = test(objectTest(value), fail);
  if (present !== null) {
    code += `let ${present} = ${String(required)};\n`;
  }
  for (const [key, property] of entries) {
    code += emitProperty(key, property, value, fail, present, names);
  }
  const declared = present ?? String(required);
  const fewer = below(declared, node.minProperties);
  if (!closed) {
    return code + test([fewer], fail);
  }
  return code + exactKeys(value, Object.keys(node.properties), declared, fewer, fail, names);
}

function emitArray(node: ArraySchema, value: string, fail: string, names: Names): string {
  const index = fresh('i', names);
  const item = fresh('v', names);
  const length = `${value}.length`;
  const head = test([`!Array.isArray(${value})`, above(length, node.maxItems), below(length, node.minItems)], fail);
  const body = emitNode(node.items, item, fail, names);
  return `${head}for (let ${index} = 0; ${index} < ${length}; ${index}++) {\nconst ${item} = ${value}[${index}];\n${body}}\n`;
}

function emitRecord(node: RecordSchema, value: string, fail: string, names: Names): string {
  const count = fresh('n', names);
  const key = fresh('k', names);
  const item = fresh('v', names);
  const limit = above(`++${count}`, node.maxProperties);
  const head = test([...objectTest(value), limit === 'true' ? limit : null], fail);
  const step = limit === null || limit === 'true' ? '' : test([limit], fail);
  const body = `${step}${emitNode(node.key, key, fail, names)}const ${item} = ${value}[${key}];\n${emitNode(node.value, item, fail, names)}`;
  return `${head}let ${count} = 0;\nfor (const ${key} in ${value}) {\n${body}}\n`;
}

// Does:  Emits one labelled block per member: a member that fails breaks to the next, and the last one fails the check.
function emitUnion(node: UnionSchema, value: string, fail: string, names: Names): string {
  const last = node.members.at(-1);
  if (last === undefined) {
    return `${fail}\n`;
  }
  if (node.members.length === 1) {
    return emitNode(last, value, fail, names);
  }
  const end = fresh('L', names);
  let code = `${end}: {\n`;
  for (const member of node.members.slice(0, -1)) {
    const label = fresh('L', names);
    code += `${label}: {\n${emitNode(member, value, `break ${label};`, names)}break ${end};\n}\n`;
  }
  return `${code}${emitNode(last, value, fail, names)}}\n`;
}

function emitNode(node: Schema, value: string, fail: string, names: Names): string {
  // Why: A node this model did not make can never pass, so its check fails closed.
  if (!isModelSchema(node)) {
    return `${fail}\n`;
  }
  switch (node.kind) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
    case 'literal':
      return test(scalarTerms(node, value), fail);
    case 'object':
      return emitObject(node, value, fail, names);
    case 'array':
      return emitArray(node, value, fail, names);
    case 'record':
      return emitRecord(node, value, fail, names);
    case 'union':
      return emitUnion(node, value, fail, names);
    case 'optional':
    case 'exposed':
      return emitNode(node.inner, value, fail, names);
  }
}

// Does:  Returns the source of a function expression that takes one value and answers true or false.
export function emitCheck(schema: Schema): string {
  return `function check(v0) {\n${emitNode(schema, 'v0', 'return false;', { next: 0 })}return true;\n}`;
}
