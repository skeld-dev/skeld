// Does:  Checks classified projection at its node limit and logging of a namespace before its bindings initialize.
// Holds: Incomplete union copies disclose no classified values, and unreadable fields never escape the log call.

import assert from 'node:assert/strict';
import { classified } from '@skeld/core/log';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { createReport } from '../support/support-proof.ts';
import * as namespace from './log-boundaries.ts';

const report = createReport('log-boundaries');
const lines: string[] = [];
const server = createServer({
  log: {
    sink: (batch) => {
      lines.push(...batch);
    },
  },
});
const { log } = server;
const projections: { name: string; message: string; verify: (text: string) => void }[] = [];

function prove(name: string, run: () => void): void {
  try {
    run();
    report.result(name, [], 'assertions passed');
  } catch (error) {
    report.result(name, [error instanceof Error ? error.message : 'non-error thrown'], '');
  }
}

function observe(name: string, schema: t.Schema, value: unknown, verify: (text: string) => void): void {
  const message = `projection-${projections.length}`;
  projections.push({ name, message, verify });
  log.info(message, { value: classified(schema, value) });
}

function recordFor(message: string): Record<string, unknown> {
  const records: Record<string, unknown>[] = lines.map((line) => JSON.parse(line));
  const matching = records.filter((entry) => entry.message === message);
  assert.equal(matching.length, 1);
  const record = matching[0];
  assert.ok(record);
  return record;
}

// Why: A module's own namespace is available before its exported const initializes, without any Proxy or getter.
prove('BUG-041 a namespace with an uninitialized binding does not escape the log call', () => {
  assert.doesNotThrow(() => log.info('namespace-tdz', namespace));
});
export const ready = true;
log.info('namespace-initialized', namespace);

const markers: string[] = [];
for (const sensitivity of ['secret', 'personal'] as const) {
  const marker = `SYNTHETIC_${sensitivity.toUpperCase()}_MUST_NOT_LEAVE`;
  markers.push(marker);
  const full = t.object({
    kind: t.literal('a'),
    password: t.string({ maxLength: 64, sensitivity }),
    items: t.array(t.integer(), { maxItems: 1000 }),
    junk: t.integer(),
    mode: t.literal('modern'),
  });
  const legacy = t.object(
    {
      kind: t.literal('a'),
      password: t.string({ maxLength: 64 }),
      mode: t.optional(t.literal('legacy')),
    },
    { open: 'legacy clients send more keys' },
  );
  const union = t.union([full, legacy]);
  for (const count of [0, 249, 250, 251, 252, 400]) {
    const value = {
      kind: 'a',
      password: marker,
      items: Array.from({ length: count }, (_, index) => index),
      junk: 1,
      mode: 'modern',
    };
    observe(`SEC-015 ${sensitivity} union with ${count} array items`, union, value, (text) => {
      assert.equal('value' in full['~standard'].validate(value), true);
      assert.equal('value' in legacy['~standard'].validate(value), false);
      assert.equal(text.includes(marker), false);
      if (count <= 249) {
        assert.ok(text.includes(`"password":"[${sensitivity}]"`));
      } else {
        assert.equal(text, `"[${sensitivity}]"`);
      }
    });
  }
}

const order = t.object({ kind: t.literal('order'), items: t.array(t.integer(), { maxItems: 1000 }) });
const orderUnion = t.union([order, t.object({ kind: t.literal('ping') })]);
for (const count of [252, 253]) {
  const value = { kind: 'order', items: Array.from({ length: count }, (_, index) => index) };
  observe(`SEC-015 unclassified union copy at ${count} items`, orderUnion, value, (text) => {
    assert.equal('value' in orderUnion['~standard'].validate(value), true);
    assert.equal(text.includes('[invalid]'), false);
    assert.equal(text === JSON.stringify('[truncated]'), count === 253);
  });
}
observe('SEC-015 an invalid complete union stays invalid', orderUnion, { kind: 'missing' }, (text) => {
  assert.equal(text, JSON.stringify('[invalid]'));
});

const item = t.union([t.object({ k: t.literal('x'), v: t.integer() }), t.object({ k: t.literal('y') })]);
observe(
  'SEC-015 nested unions stop at the budget',
  t.array(item, { maxItems: 1000 }),
  Array.from({ length: 200 }, (_, v) => ({ k: 'x', v })),
  (text) => {
    assert.ok(text.includes('[truncated]'));
    assert.equal(text.includes('[invalid]'), false);
    const values: unknown = JSON.parse(text);
    assert.ok(Array.isArray(values));
    assert.ok(values.length < 200);
  },
);

let getterCalls = 0;
const accessors: Record<string, unknown> = {};
const array: unknown[] = [];
const properties: Record<string, t.Schema> = {};
for (let index = 0; index < 5000; index++) {
  const descriptor = {
    enumerable: true,
    get() {
      getterCalls++;
      return 'unread';
    },
  };
  Object.defineProperty(accessors, `k${index}`, descriptor);
  Object.defineProperty(array, index, descriptor);
  properties[`k${index}`] = t.integer();
}
const record = t.record(t.string({ maxLength: 64 }), t.integer(), { maxProperties: 5000 });
for (const [name, schema, value] of [
  ['record', record, accessors],
  ['object', t.object(properties), accessors],
  ['array', t.array(t.integer(), { maxItems: 5000 }), array],
] as const) {
  observe(`SEC-015 ${name} accessor entries consume the node budget`, schema, value, (text) => {
    assert.equal(text.match(/\[invalid\]/g)?.length, 255);
    assert.equal(text.match(/\[truncated\]/g)?.length, 1);
    assert.equal(getterCalls, 0);
  });
}
observe(
  'SEC-015 union copying charges unreadable entries',
  t.union([record, t.object({}, { open: 'accept extra fields' })]),
  accessors,
  (text) => {
    assert.equal(text, JSON.stringify('[truncated]'));
    assert.equal(getterCalls, 0);
  },
);

observe(
  'SEC-015 sparse array items consume the node budget',
  t.array(t.integer(), { maxItems: 5000 }),
  Array(5000),
  (text) => {
    assert.equal(text.match(/\[invalid\]/g)?.length, 255);
    assert.equal(text.match(/\[truncated\]/g)?.length, 1);
  },
);

await server.close();
for (const { name, message, verify } of projections) {
  prove(name, () => {
    const fields = recordFor(message).fields;
    assert.ok(typeof fields === 'object' && fields !== null && 'value' in fields);
    const text = JSON.stringify(fields.value);
    assert.equal(typeof text, 'string');
    assert.ok(text);
    verify(text);
  });
}
prove('SEC-015 no classified marker reaches the sink', () => {
  for (const marker of markers) {
    assert.equal(
      lines.some((line) => line.includes(marker)),
      false,
    );
  }
});
prove('BUG-041 the message survives without fields; an initialized namespace still works', () => {
  assert.equal(recordFor('namespace-tdz').fields, undefined);
  assert.deepEqual(recordFor('namespace-initialized').fields, { ready: true });
});
report.finish();
