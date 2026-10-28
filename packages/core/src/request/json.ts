import type { JsonParseResult } from './types.ts';

export function parseJsonBody(text: string): JsonParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { kind: 'invalid-json' };
    }
    throw error;
  }
  if (!mayHoldForbiddenKey(text)) {
    return { kind: 'ok', value };
  }
  const key = findForbiddenKey(value);
  return key === null ? { kind: 'ok', value } : { kind: 'forbidden-key', key };
}

// A key spelled with \u escapes reaches JSON.parse as the plain name, so any escape forces the walk.
function mayHoldForbiddenKey(text: string): boolean {
  return text.includes('__proto__') || text.includes('constructor') || text.includes('\\u');
}

function findForbiddenKey(root: unknown): '__proto__' | 'constructor.prototype' | null {
  if (!isObject(root)) {
    return null;
  }
  const pending: object[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '__proto__') {
        return '__proto__';
      }
      if (!isObject(value)) {
        continue;
      }
      if (key === 'constructor' && Object.hasOwn(value, 'prototype')) {
        return 'constructor.prototype';
      }
      pending.push(value);
    }
  }
  return null;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
