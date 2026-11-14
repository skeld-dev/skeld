// Does:  Exercises the schema-emission and parser boundaries flagged by the hosted CodeQL scan.
// Holds: Hostile names remain data; malformed numeric declarations never enter generated source.

import assert from 'node:assert/strict';
// biome-ignore lint/correctness/noUnresolvedImports: test-only export resolved by skeld-source
import { generateCheck, generateSerializer } from '@skeld/core/generated-check';
import * as t from '@skeld/core/schema';
// biome-ignore lint/style/noRestrictedImports: white-box regression for the exact CodeQL parser sink
import { parseCookies } from '../../packages/core/src/cookie/parse.ts';
// biome-ignore lint/style/noRestrictedImports: white-box regression for the exact CodeQL parser sink
import { parseQuery } from '../../packages/core/src/request/query.ts';

const before = Object.getOwnPropertyDescriptors(Object.prototype);
const names = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
for (const name of names) {
  const query = parseQuery(`${name}=first&${name}=second&${name}=third`);
  const cookies = parseCookies(`${name}=first; ${name}=second; ${name}=third`);
  for (const parsed of [query, cookies]) {
    assert.equal(Object.getPrototypeOf(parsed), null);
    assert.equal(Object.hasOwn(parsed, name), true);
    assert.deepEqual(parsed[name], ['first', 'second', 'third']);
  }
  assert.equal(Object.isFrozen(cookies), true);
  assert.equal(Object.isFrozen(cookies[name]), true);
}
assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);

const payload = '");throw new Error("injected schema source");//';
const schema = t.object({ [payload]: t.literal(payload) });
const value = { [payload]: payload };
assert.equal(generateCheck(schema)(value), true);
assert.equal(generateCheck(schema)({ [payload]: 'other' }), false);
const serialized = generateSerializer(schema).write(value);
assert.equal(typeof serialized, 'string');
assert.deepEqual(JSON.parse(String(serialized)), value);

let coerced = 0;
const hostile = {
  toString() {
    coerced++;
    throw new Error('numeric declaration was coerced');
  },
};
for (const bound of [payload, hostile]) {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: intentionally malformed JavaScript declaration
  const numeric = bound as unknown as number;
  for (const invalid of [
    t.number({ minimum: numeric }),
    t.number({ maximum: numeric }),
    t.string({ minLength: numeric, maxLength: 32 }),
    t.string({ maxLength: numeric }),
  ]) {
    for (const input of [0, 'text']) {
      assert.equal(generateCheck(invalid)(input), false);
      assert.equal(typeof generateSerializer(invalid).write(input), 'number');
    }
  }
}
// biome-ignore lint/nursery/noUnsafeTypeAssertion: intentionally malformed JavaScript declaration
assert.throws(() => t.literal(hostile as unknown as number), TypeError);
assert.equal(coerced, 0);
process.stdout.write('pass CodeQL boundaries: parser prototype names and schema source injection\n');
