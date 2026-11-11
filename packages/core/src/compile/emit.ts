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
  return code + exactKeys(value, declared, fewer, fail, names);
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

export function emitCheck(schema: Schema): string {
  return `function check(v0) {\n${emitNode(schema, 'v0', 'return false;', { next: 0 })}return true;\n}`;
}
