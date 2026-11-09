import { end, key, start } from '#diag';
import type { JsonParseResult } from './types.ts';

export function parseJsonBody(text: string): JsonParseResult {
  const span = start('req.body.parse');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    end(span);
    if (error instanceof SyntaxError) {
      return { kind: 'invalid-json' };
    }
    throw error;
  }
  end(span);
  if (!mayHoldForbiddenKey(text)) {
    return { kind: 'ok', value };
  }
  const forbidden = findForbiddenKey(value);
  return forbidden === null ? { kind: 'ok', value } : { kind: 'forbidden-key', key: forbidden };
}

// A key spelled with \u escapes reaches JSON.parse as the plain name, so any escape forces the walk.
function mayHoldForbiddenKey(text: string): boolean {
  return text.includes('__proto__') || text.includes('constructor') || text.includes('\\u');
}

function findForbiddenKey(root: unknown): '__proto__' | 'constructor.prototype' | null {
  if (!isObject(root)) {
    return null;
  }
  const span = start('req.body.forbidden_key');
  const pending: object[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const [name, value] of Object.entries(node)) {
      key(name);
      if (name === '__proto__') {
        end(span);
        return '__proto__';
      }
      if (!isObject(value)) {
        continue;
      }
      if (name === 'constructor' && Object.hasOwn(value, 'prototype')) {
        end(span);
        return 'constructor.prototype';
      }
      pending.push(value);
    }
  }
  end(span);
  return null;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
