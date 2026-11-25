// Does:  Catches a schema reason string or an unexposed response secret reaching a published OpenAPI document.
// Holds: The whole serialized result is searched; every unexposed response secret refuses with its property's location.

import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createOpenApi } from '@skeld/openapi';
import { OpenApiError } from '@skeld/openapi/openapi-error';
import { check, conclude } from '../support/support.ts';

const problems: string[] = [];
const info = { title: 'Private text', version: '1' };
const reason = (n: number): string => `REASON-SENTINEL-${n}-c41d`;
const secret = (): t.StringSchema<t.Secret<string>> => t.string({ maxLength: 40, sensitivity: 'secret' });

const contract = defineContract({
  write: {
    method: 'POST',
    path: '/write',
    body: t.object(
      {
        free: t.string({ unbounded: reason(1) }),
        list: t.array(t.object({ x: t.integer() }, { open: reason(2) }), { unbounded: reason(3) }),
        map: t.record(t.string({ maxLength: 8 }), t.union([t.string({ unbounded: reason(4) }), t.integer()]), {
          unbounded: reason(5),
        }),
        password: secret(),
      },
      { open: reason(6) },
    ),
    responses: {
      200: t.object({
        tokens: t.array(t.exposed(secret(), reason(7)), { maxItems: 3 }),
        either: t.union([t.exposed(secret(), reason(8)), t.null()]),
        byName: t.record(t.string({ maxLength: 8 }), t.exposed(secret(), reason(9)), { maxProperties: 4 }),
        nested: t.object({ deep: t.array(t.union([t.exposed(secret(), reason(10)), t.integer()]), { maxItems: 2 }) }),
      }),
    },
  },
});
const result = createOpenApi(contract, { info });
const text = JSON.stringify(result);
for (let n = 1; n <= 10; n++) {
  check(problems, !text.includes(reason(n)), `reason ${n} appears in the generated result`);
}
check(problems, !text.includes('REASON-SENTINEL'), 'a reason fragment appears in the generated result');
for (const key of ['x-open', 'x-unbounded', 'x-exposure']) {
  check(problems, !text.includes(`"${key}"`), `the private key ${key} appears in the generated result`);
}

const response = JSON.stringify(result.document.paths['/write']?.post?.responses?.['200']);
check(
  problems,
  (response.match(/"x-sensitivity":"secret"/g) ?? []).length === 4,
  'an exposed response secret lost its sensitivity',
);
check(problems, !response.includes('writeOnly'), 'an exposed response secret is marked writeOnly');
const body = JSON.stringify(result.document.paths['/write']?.post?.requestBody);
check(problems, body.includes('"writeOnly":true'), 'the request secret is not marked writeOnly');

const unexposed: [string, t.Schema, readonly (string | number)[]][] = [
  ['an array item', t.object({ a: t.array(secret(), { maxItems: 2 }) }), ['r', 'responses', 200, 'properties', 'a']],
  ['a union member', t.object({ u: t.union([t.null(), secret()]) }), ['r', 'responses', 200, 'properties', 'u']],
  [
    'a record value',
    t.object({ m: t.record(t.string({ maxLength: 3 }), secret(), { maxProperties: 2 }) }),
    ['r', 'responses', 200, 'properties', 'm'],
  ],
  [
    'a secret object',
    t.object({ o: t.object({ k: t.string({ maxLength: 3 }) }, { sensitivity: 'secret' }) }),
    ['r', 'responses', 200, 'properties', 'o'],
  ],
];
for (const [where, schema, location] of unexposed) {
  let caught: unknown;
  try {
    createOpenApi(defineContract({ r: { method: 'GET', path: '/r', responses: { 200: schema } } }), { info });
  } catch (error) {
    caught = error;
  }
  const refusal = caught;
  const located =
    refusal instanceof OpenApiError &&
    refusal.code === 'INVALID_SCHEMA' &&
    refusal.message === 'Invalid documentation schema' &&
    location.every((part, i) => refusal.location[i] === part);
  check(problems, located, `an unexposed secret in ${where} of a response was not refused at ${location.join('.')}`);
}

conclude('reason strings and unexposed response secrets stay out of the generated document', problems);
