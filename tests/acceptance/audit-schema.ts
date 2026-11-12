// Does:  Checks schema audit regressions through public validation, generated checks and real HTTP responses.
// Holds: Closed keys, captured children and sensitive union failures keep the same meaning across consumers.

import assert from 'node:assert/strict';
import { defineContract } from '@darkstart/core/contract';
// biome-ignore lint/correctness/noUnresolvedImports: the proof seam is available only under darkstart-source
import { generateCheck } from '@darkstart/core/generated-check';
import { toJsonSchema } from '@darkstart/core/json-schema';
import * as t from '@darkstart/core/schema';
import { expose, Secret } from '@darkstart/core/secret';
import { createServer } from '@darkstart/core/server';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function reusable(options: t.StringOptions) {
  return t.string(options);
}
const widened = reusable({ maxLength: 64, sensitivity: 'secret' });
const literal = t.string({ maxLength: 64, sensitivity: 'secret' });
const personal = t.string({ maxLength: 64, sensitivity: 'personal' });
const plain = t.string({ maxLength: 64 });
const widenedProof: Equal<(typeof widened)['~static'], string | Secret<string>> = true;
const literalProof: Equal<(typeof literal)['~static'], Secret<string>> = true;
const personalProof: Equal<(typeof personal)['~static'], string> = true;
const plainProof: Equal<(typeof plain)['~static'], string> = true;
assert.ok(widenedProof && literalProof && personalProof && plainProof);
const wrapped = widened['~standard'].validate('captured-token');
assert.ok('value' in wrapped && wrapped.value instanceof Secret);
assert.equal(expose(wrapped.value), 'captured-token');

const closed = t.object({ id: t.integer({ minimum: 0, maximum: 100 }) });
const hidden = Object.defineProperty({ admin: true }, 'id', { value: 7, enumerable: false });
class InheritedId {
  admin = true;
  get id() {
    return 7;
  }
}
class Ordinary {
  id = 7;
}
for (const invalid of [hidden, new InheritedId(), { id: 7, admin: true }]) {
  assert.ok('issues' in closed['~standard'].validate(invalid));
  assert.equal(generateCheck(closed)(invalid), false);
}
for (const valid of [{ id: 7 }, new Ordinary()]) {
  assert.ok('value' in closed['~standard'].validate(valid));
  assert.equal(generateCheck(closed)(valid), true);
}

let reads = 0;
let child: t.Schema = t.string({ maxLength: 8 });
const properties = {
  get data() {
    reads++;
    return child;
  },
};
const captured = t.object(properties);
assert.equal(reads, 1);
const oldCheck = generateCheck(captured);
assert.ok('value' in captured['~standard'].validate({ data: 'stable' }));
const exported = JSON.stringify(toJsonSchema(captured));
child = t.integer();
assert.equal(reads, 1);
assert.equal(Object.isFrozen(properties), false);
assert.equal(Object.isFrozen(captured.properties), true);
assert.equal(Object.getPrototypeOf(captured.properties), null);
assert.equal(Object.getOwnPropertyDescriptor(captured.properties, 'data')?.get, undefined);
assert.equal(JSON.stringify(toJsonSchema(captured)), exported);
for (const check of [oldCheck, generateCheck(captured)]) {
  assert.equal(check({ data: 'stable' }), true);
  assert.equal(check({ data: 123 }), false);
}
assert.ok('issues' in captured['~standard'].validate({ data: 123 }));
assert.throws(
  () =>
    t.object({
      get data(): never {
        throw new Error('getter failure');
      },
    }),
  /getter failure/,
);

let extensionReads = 0;
let extensionChild: t.Schema = t.boolean();
const extension = t.extend(t.object({}), {
  get extra() {
    extensionReads++;
    return extensionChild;
  },
});
extensionChild = t.integer();
assert.equal(extensionReads, 1);
assert.ok('value' in extension['~standard'].validate({ extra: true }));
assert.equal(generateCheck(extension)({ extra: 1 }), false);
const members: t.Schema[] = [t.boolean()];
const capturedUnion = t.union(members);
members[0] = t.integer();
assert.equal(Object.isFrozen(members), false);
assert.equal(Object.isFrozen(capturedUnion.members), true);
assert.ok('value' in capturedUnion['~standard'].validate(true));
assert.equal(generateCheck(capturedUnion)(1), false);

const marker = 'CLASSIFIED_RECEIVED_KEY_728491';
const publicMember = t.object({ public: t.boolean() });
const classified = (sensitivity: 'secret' | 'personal') =>
  t.record(t.string({ maxLength: 64 }), t.string({ maxLength: 64 }), { maxProperties: 10, sensitivity });
const secretUnion = t.union([classified('secret'), publicMember]);
const personalUnion = t.union([publicMember, classified('personal')]);
for (const schema of [secretUnion, personalUnion, t.object({ nested: t.optional(secretUnion) })]) {
  const value = schema === secretUnion || schema === personalUnion ? { [marker]: 123 } : { nested: { [marker]: 123 } };
  const result = schema['~standard'].validate(value);
  assert.ok('issues' in result);
  assert.equal(JSON.stringify(result).includes(marker), false);
}

const server = createServer();
server.routes(
  defineContract({
    captured: { method: 'POST', path: '/captured', body: captured, responses: { 200: captured } },
    closed: {
      method: 'GET',
      path: '/closed',
      responses: {
        200: t.union([closed, t.object({ id: t.integer({ minimum: 0, maximum: 100 }), admin: t.boolean() })]),
      },
    },
    union: {
      method: 'GET',
      path: '/union',
      responses: {
        200: t.union([closed, t.object({ id: t.integer({ minimum: 0, maximum: 100 }), admin: t.boolean() })]),
      },
    },
    secret: { method: 'POST', path: '/secret', body: secretUnion, responses: { 204: null } },
    personal: { method: 'POST', path: '/personal', body: personalUnion, responses: { 204: null } },
  }),
  {
    captured: ({ body }) => ({ status: 200, body }),
    closed: () => ({ status: 200, body: new InheritedId() }),
    union: () => ({ status: 200, body: { id: 7, admin: true } }),
    secret: () => ({ status: 204 }),
    personal: () => ({ status: 204 }),
  },
);
const { port } = await server.listen({ port: 0 });
const base = `http://127.0.0.1:${port}`;
try {
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const accepted = await post('/captured', { data: 'stable' });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { data: 'stable' });
  const refused = await post('/captured', { data: 123 });
  assert.equal(refused.status, 400);
  await refused.text();
  const invalidResponse = await fetch(`${base}/closed`);
  assert.equal(invalidResponse.status, 500);
  await invalidResponse.text();
  const union = await fetch(`${base}/union`);
  assert.equal(union.status, 200);
  assert.deepEqual(await union.json(), { id: 7, admin: true });
  await Promise.all(
    ['/secret', '/personal'].map(async (path) => {
      const response = await post(path, { [marker]: 123 });
      assert.equal(response.status, 400);
      assert.equal((await response.text()).includes(marker), false);
    }),
  );
} finally {
  await server.close();
}
process.stdout.write('pass schema audit: widened types, closed key identities, captured accessors, union privacy\n');
