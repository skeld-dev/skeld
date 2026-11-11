// Does:  Emits the JavaScript source of the response serializer, which tests each value as it writes it.
// Holds: A value the check would refuse is never written; the function returns the index of the refusing location.

import { isModelSchema } from '../schema/node.ts';
import { toPointer } from '../schema/pointer.ts';
import type { ArraySchema, ObjectSchema, RecordSchema, Schema, UnionSchema } from '../schema/types.ts';
import { above, below, exactKeys, fresh, type Names, objectTest, optionalInner, scalarTerms, test } from './terms.ts';

export interface SerializerSource {
  readonly source: string;
  readonly refusals: readonly string[];
}

interface Emission {
  readonly names: Names;
  readonly refusals: string[];
}

// Does:  Where a node writes: its sink variable, whether objects must be exact, where a failure jumps, its path.
interface Place {
  readonly sink: string;
  readonly exact: boolean;
  readonly escape: string | null;
  readonly path: readonly string[];
}

// Does:  Text owed before the next write: a run-time expression first, then constant text folded into one append.
interface Lead {
  readonly before: string | null;
  readonly text: string;
}

// Does:  The code for one node and the constant text it still owes to whatever is written next.
interface Emitted {
  readonly code: string;
  readonly owed: string;
}

// Does:  How far an object has got: whether a key was certainly written, or the variable that holds its comma.
interface Opening {
  readonly comma: string | null;
  readonly certain: boolean;
  readonly pending: Lead;
}

interface Step {
  readonly code: string;
  readonly opening: Opening;
}

interface Member {
  readonly key: string;
  readonly holder: string;
  readonly place: Place;
  readonly present: string | null;
}

const NOTHING: Lead = { before: null, text: '' };
const ANY_ENTRY = '*';

function then(lead: Lead, text: string): Lead {
  return { before: lead.before, text: lead.text + text };
}

function constant(text: string): string | null {
  return text === '' ? null : JSON.stringify(text);
}

function write(sink: string, terms: readonly (string | null)[]): string {
  const present = terms.filter((term) => term !== null);
  return present.length === 0 ? '' : `${sink} += ${present.join(' + ')};\n`;
}

function flush(sink: string, lead: Lead): string {
  return write(sink, [lead.before, constant(lead.text)]);
}

function settle(sink: string, lead: Lead, text: string): Emitted {
  return { code: write(sink, [lead.before]), owed: lead.text + text };
}

function separator(lead: Lead, opening: string, comma: string): string {
  const start = lead.before === null ? '' : `${lead.before} + `;
  return `let ${comma} = ${start}${JSON.stringify(lead.text + opening)};\n`;
}

// Does:  Returns the statement a refusal runs: a jump out of a union member, or a return of the location's index.
// Holds: A location is a path of declared names and '*' only, never a value, a record key or an array index.
function failAt(place: Place, emission: Emission): string {
  if (place.escape !== null) {
    return place.escape;
  }
  const location = toPointer(place.path);
  const known = emission.refusals.indexOf(location);
  const index = known === -1 ? emission.refusals.push(location) - 1 : known;
  return `return ${String(index)};`;
}

function within(place: Place, segment: string): Place {
  return { ...place, path: [...place.path, segment] };
}

function named(opening: Opening, key: string): Lead {
  return then(opening.pending, `${opening.certain ? ',' : ''}${JSON.stringify(key)}:`);
}

function emitRequired(member: Member, property: Schema, opening: Opening, emission: Emission): Step {
  const { key, holder, place } = member;
  const quoted = JSON.stringify(key);
  const item = fresh('v', emission.names);
  const at = within(place, key);
  const own = key in Object.prototype ? test([`!Object.hasOwn(${holder}, ${quoted})`], failAt(at, emission)) : '';
  const written = emitNode(property, item, at, named(opening, key), emission);
  return {
    code: `${own}const ${item} = ${holder}[${quoted}];\n${written.code}`,
    opening: { comma: null, certain: true, pending: { before: null, text: written.owed } },
  };
}

function emitOptional(member: Member, inner: Schema, opening: Opening, emission: Emission): Step {
  const { key, holder, place, present } = member;
  const { sink } = place;
  const { comma } = opening;
  const quoted = JSON.stringify(key);
  const item = fresh('v', emission.names);
  const joined: Opening = comma === null ? { ...opening, pending: NOTHING } : opening;
  const written = emitNode(inner, item, within(place, key), named(joined, key), emission);
  const counting = present === null ? '' : `${present}++;\n`;
  const settled = comma === null ? '' : `${comma} = ",";\n`;
  const closing = write(sink, [constant(written.owed)]);
  const block = `const ${item} = ${holder}[${quoted}];\nif (${item} !== undefined) {\n${counting}${written.code}${closing}${settled}}\n`;
  const guarded = key in Object.prototype ? `if (Object.hasOwn(${holder}, ${quoted})) {\n${block}}\n` : block;
  return { code: (comma === null ? flush(sink, opening.pending) : '') + guarded, opening: joined };
}

function closeObject(opening: Opening, lead: Lead, sink: string): Emitted {
  if (opening.certain) {
    return { code: '', owed: `${opening.pending.text}}` };
  }
  if (opening.comma !== null) {
    return { code: `if (${opening.comma} !== ",") ${sink} += ${opening.comma};\n`, owed: '}' };
  }
  return settle(sink, lead, '{}');
}

function emitObject(node: ObjectSchema, value: string, place: Place, lead: Lead, emission: Emission): Emitted {
  const { names } = emission;
  const fail = failAt(place, emission);
  const entries = Object.entries(node.properties);
  const required = entries.filter(([, property]) => optionalInner(property) === null).length;
  const exact = place.exact && node.open === undefined;
  const counted = exact || node.minProperties !== undefined;
  const present = counted && required < entries.length ? fresh('p', names) : null;
  const [first] = entries;
  // Why: When the first key is optional, whether a comma is owed is known only at run time, so a variable carries it.
  const comma = first !== undefined && optionalInner(first[1]) !== null ? fresh('c', names) : null;
  let opening: Opening = {
    comma,
    certain: false,
    pending: comma === null ? then(lead, '{') : { before: comma, text: '' },
  };
  let code = test(objectTest(value), fail);
  code += present === null ? '' : `let ${present} = ${String(required)};\n`;
  code += comma === null ? '' : separator(lead, '{', comma);
  for (const [key, property] of entries) {
    const member: Member = { key, holder: value, place, present };
    const inner = optionalInner(property);
    const step =
      inner === null
        ? emitRequired(member, property, opening, emission)
        : emitOptional(member, inner, opening, emission);
    code += step.code;
    opening = step.opening;
  }
  const closed = closeObject(opening, lead, place.sink);
  const declared = present ?? String(required);
  const fewer = below(declared, node.minProperties);
  const counts = exact ? exactKeys(value, declared, fewer, fail, names) : test([fewer], fail);
  return { code: code + closed.code + counts, owed: closed.owed };
}

function emitArray(node: ArraySchema, value: string, place: Place, lead: Lead, emission: Emission): Emitted {
  const { names } = emission;
  const { sink } = place;
  const fail = failAt(place, emission);
  const length = fresh('n', names);
  const index = fresh('i', names);
  const item = fresh('v', names);
  const comma = fresh('c', names);
  const bounds = test([above(length, node.maxItems), below(length, node.minItems)], fail);
  // Why: length is read once and the bounds tested before the loop, so an over-long array is refused before any write.
  const head = `${test([`!Array.isArray(${value})`], fail)}const ${length} = ${value}.length;\n${bounds}`;
  const written = emitNode(node.items, item, within(place, ANY_ENTRY), { before: comma, text: '' }, emission);
  const next = `${comma} = ${JSON.stringify(`${written.owed},`)};\n`;
  const loop = `for (let ${index} = 0; ${index} < ${length}; ${index}++) {\nconst ${item} = ${value}[${index}];\n${written.code}${next}}\n`;
  const last =
    written.owed === ''
      ? `if (${length} === 0) ${sink} += ${comma};\n`
      : `${sink} += ${length} === 0 ? ${comma} : ${JSON.stringify(written.owed)};\n`;
  return { code: head + separator(lead, '[', comma) + loop + last, owed: ']' };
}

function emitRecord(node: RecordSchema, value: string, place: Place, lead: Lead, emission: Emission): Emitted {
  const { names } = emission;
  const { sink } = place;
  const fail = failAt(place, emission);
  const keys = fresh('k', names);
  const index = fresh('i', names);
  const key = fresh('k', names);
  const item = fresh('v', names);
  const comma = fresh('c', names);
  const count = `${keys}.length`;
  // Why: Object.keys lists own enumerable string keys once, so an inherited key is never written.
  const head = `${test(objectTest(value), fail)}const ${keys} = Object.keys(${value});\n${test([above(count, node.maxProperties)], fail)}`;
  const keyed: Lead = { before: `${comma} + "\\"" + escaped(${key})`, text: '":' };
  const written = emitNode(node.value, item, within(place, ANY_ENTRY), keyed, emission);
  const next = `${comma} = ${JSON.stringify(`${written.owed},`)};\n`;
  const entry = `const ${key} = ${keys}[${index}];\n${test(scalarTerms(node.key, key), fail)}const ${item} = ${value}[${key}];\n${written.code}${next}`;
  const loop = `for (let ${index} = 0; ${index} < ${count}; ${index}++) {\n${entry}}\n`;
  const last =
    written.owed === ''
      ? `if (${count} === 0) ${sink} += ${comma};\n`
      : `${sink} += ${count} === 0 ? ${comma} : ${JSON.stringify(written.owed)};\n`;
  return { code: head + separator(lead, '{', comma) + loop + last, owed: '}' };
}

// Does:  Emits one attempt per member into its own string; the first to complete is appended, the others discarded.
function emitUnion(node: UnionSchema, value: string, place: Place, lead: Lead, emission: Emission): Emitted {
  const { names } = emission;
  const end = fresh('L', names);
  let code = `${end}: {\n`;
  for (const member of node.members) {
    const label = fresh('L', names);
    const text = fresh('s', names);
    // Why: A member must match exactly here, or an object with extra keys would be written as the wrong member.
    const attempt: Place = { sink: text, exact: true, escape: `break ${label};`, path: place.path };
    const written = emitNode(member, value, attempt, NOTHING, emission);
    const matched = write(place.sink, [lead.before, constant(lead.text), text, constant(written.owed)]);
    code += `${label}: {\nlet ${text} = "";\n${written.code}${matched}break ${end};\n}\n`;
  }
  return { code: `${code}${failAt(place, emission)}\n}\n`, owed: '' };
}

function emitNode(node: Schema, value: string, place: Place, lead: Lead, emission: Emission): Emitted {
  const { sink } = place;
  if (!isModelSchema(node)) {
    return { code: `${failAt(place, emission)}\n`, owed: '' };
  }
  switch (node.kind) {
    case 'string': {
      const refused = test(scalarTerms(node, value), failAt(place, emission));
      return { code: `${refused}${flush(sink, then(lead, '"'))}${sink} += escaped(${value});\n`, owed: '"' };
    }
    case 'integer':
    case 'number': {
      const refused = test(scalarTerms(node, value), failAt(place, emission));
      return { code: `${refused}${flush(sink, lead)}${sink} += ${value};\n`, owed: '' };
    }
    case 'boolean': {
      const refused = test(scalarTerms(node, value), failAt(place, emission));
      const opened = settle(sink, lead, '');
      const either = `${value} ? ${JSON.stringify(`${opened.owed}true`)} : ${JSON.stringify(`${opened.owed}false`)}`;
      return { code: `${refused}${opened.code}${sink} += ${either};\n`, owed: '' };
    }
    case 'null': {
      const written = settle(sink, lead, 'null');
      return { code: test(scalarTerms(node, value), failAt(place, emission)) + written.code, owed: written.owed };
    }
    case 'literal': {
      const written = settle(sink, lead, JSON.stringify(node.value));
      return { code: test(scalarTerms(node, value), failAt(place, emission)) + written.code, owed: written.owed };
    }
    case 'object':
      return emitObject(node, value, place, lead, emission);
    case 'array':
      return emitArray(node, value, place, lead, emission);
    case 'record':
      return emitRecord(node, value, place, lead, emission);
    case 'union':
      return emitUnion(node, value, place, lead, emission);
    case 'optional':
    case 'exposed':
      return emitNode(node.inner, value, place, lead, emission);
  }
}

// Does:  Returns the source of a factory that takes the escaper and returns the serializer, with its locations.
export function emitSerializer(schema: Schema): SerializerSource {
  const emission: Emission = { names: { next: 0 }, refusals: [] };
  const place: Place = { sink: 'j', exact: false, escape: null, path: [] };
  const written = emitNode(schema, 'v0', place, NOTHING, emission);
  const result = written.owed === '' ? 'j' : `j + ${JSON.stringify(written.owed)}`;
  const source = `function make(escaped) {\nreturn function serialize(v0) {\nlet j = "";\n${written.code}return ${result};\n};\n}`;
  return { source, refusals: emission.refusals };
}
