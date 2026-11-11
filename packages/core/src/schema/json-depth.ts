// Does:  Measures JSON nesting depth: in a text before it is parsed, and in a schema's largest valid value.
// Holds: Brackets inside a JSON string never count, and one limit serves the text scan and the schema check.

import { isModelSchema } from './node.ts';
import { toPointer } from './pointer.ts';
import type { Schema } from './types.ts';

// Why: Deep enough for any declared shape; V8's JSON.parse has no limit and a 1 MB nested body blocks it 212 ms.
export const MAX_JSON_DEPTH = 64;

// Why: Exceeding the limit takes 65 openers and their 65 closers, so shorter valid JSON cannot be too deep.
const SHORTEST_TOO_DEEP = 2 * (MAX_JSON_DEPTH + 1);

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACKET = 0x5b;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;

// Why: Depth never exceeds the count of openers, and indexOf counts them far faster than a character loop.
function fewOpeners(text: string): boolean {
  let count = 0;
  for (let at = text.indexOf('{'); at !== -1; at = text.indexOf('{', at + 1)) {
    if (++count > MAX_JSON_DEPTH) {
      return false;
    }
  }
  for (let at = text.indexOf('['); at !== -1; at = text.indexOf('[', at + 1)) {
    if (++count > MAX_JSON_DEPTH) {
      return false;
    }
  }
  return true;
}

// Does:  Returns the index of the quote that closes the string opened at start, or -1 when none does.
function stringEnd(text: string, start: number): number {
  let end = text.indexOf('"', start + 1);
  while (end !== -1) {
    let before = end - 1;
    while (text.charCodeAt(before) === BACKSLASH) {
      before--;
    }
    // Why: A quote is escaped only by an odd run of backslashes before it.
    if ((end - before) % 2 === 1) {
      return end;
    }
    end = text.indexOf('"', end + 1);
  }
  return -1;
}

// Does:  Tells whether JSON text nests arrays and objects deeper than the limit; malformed text is left to the parser.
export function exceedsJsonDepth(text: string): boolean {
  if (text.length < SHORTEST_TOO_DEEP || fewOpeners(text)) {
    return false;
  }
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    // Why: Every unit below '[' but the quote is a digit, sign, separator or space; one compare skips them.
    if (unit < OPEN_BRACKET) {
      if (unit !== QUOTE) {
        continue;
      }
      index = stringEnd(text, index);
      if (index === -1) {
        return false;
      }
    } else if ((unit | 0x20) === OPEN_BRACE) {
      if (++depth > MAX_JSON_DEPTH) {
        return true;
      }
    } else if ((unit | 0x20) === CLOSE_BRACE) {
      depth--;
    }
  }
  return false;
}

function deepNode(schema: Schema, depth: number, path: readonly (string | number)[]): string | null {
  if (!isModelSchema(schema)) {
    return null;
  }
  const inside = depth + 1;
  switch (schema.kind) {
    case 'object':
      if (inside > MAX_JSON_DEPTH) {
        return toPointer(path);
      }
      return firstDeep(
        Object.entries(schema.properties).map(([key, property]) => [property, ['properties', key]]),
        inside,
        path,
      );
    case 'array':
      return inside > MAX_JSON_DEPTH ? toPointer(path) : deepNode(schema.items, inside, [...path, 'items']);
    case 'record':
      return inside > MAX_JSON_DEPTH
        ? toPointer(path)
        : deepNode(schema.value, inside, [...path, 'additionalProperties']);
    case 'union':
      return firstDeep(
        schema.members.map((member, index) => [member, ['anyOf', index]]),
        depth,
        path,
      );
    case 'optional':
    case 'exposed':
      return deepNode(schema.inner, depth, path);
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
    case 'literal':
      return null;
  }
}

function firstDeep(
  children: readonly (readonly [Schema, readonly (string | number)[]])[],
  depth: number,
  path: readonly (string | number)[],
): string | null {
  for (const [child, segments] of children) {
    const found = deepNode(child, depth, [...path, ...segments]);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

// Does:  Returns the JSON pointer of the first node whose values would nest deeper than the limit, or null.
export function tooDeepPointer(schema: Schema): string | null {
  return deepNode(schema, 0, []);
}
