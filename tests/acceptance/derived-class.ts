// Does:  Proves that bounds, closure and sensitivity survive derivation with partial, pick, omit and extend.
// Holds: A handler that must not run is watched, so a request accepted by mistake fails the script.

import { randomBytes } from 'node:crypto';
import { BootError } from '@darkstart/core/boot-error';
import { defineContract } from '@darkstart/core/contract';
import { redact } from '@darkstart/core/redact';
import * as t from '@darkstart/core/schema';
import { Secret } from '@darkstart/core/secret';
import { createServer } from '@darkstart/core/server';

const exposedReason = 'the derived credentials are meant to leave the service';
const markerKey = `key${randomBytes(10).toString('hex')}`;
const markerValue = `val${randomBytes(10).toString('hex')}`;

const creds = t.object(
  { user: t.string({ maxLength: 36 }), pass: t.string({ maxLength: 64 }) },
  { sensitivity: 'secret' },
);
const person = t.object(
  { email: t.string({ maxLength: 16 }), name: t.string({ maxLength: 36 }) },
  { sensitivity: 'personal' },
);

interface Derivation {
  name: string;
  schema: t.Schema;
  wrapped?: t.Schema;
  valid: unknown;
}

const credsDerivations: readonly Derivation[] = [
  {
    name: 'pick',
    schema: t.pick(creds, ['user']),
    wrapped: t.exposed(t.pick(creds, ['user']), exposedReason),
    valid: { user: 'ada' },
  },
  {
    name: 'omit',
    schema: t.omit(creds, ['pass']),
    wrapped: t.exposed(t.omit(creds, ['pass']), exposedReason),
    valid: { user: 'ada' },
  },
  {
    name: 'partial',
    schema: t.partial(creds),
    wrapped: t.exposed(t.partial(creds), exposedReason),
    valid: { user: 'ada' },
  },
  {
    name: 'extend',
    schema: t.extend(creds, {}),
    wrapped: t.exposed(t.extend(creds, {}), exposedReason),
    valid: { user: 'ada', pass: 'lovelace' },
  },
];

const personDerivations: readonly Derivation[] = [
  { name: 'pick', schema: t.pick(person, ['email']), valid: { email: 'a@b.c' } },
  { name: 'omit', schema: t.omit(person, ['name']), valid: { email: 'a@b.c' } },
  { name: 'partial', schema: t.partial(person), valid: { email: 'a@b.c' } },
  { name: 'extend', schema: t.extend(person, {}), valid: { email: 'a@b.c', name: 'Ada' } },
];

const neverCalled = (): never => {
  throw new Error('a handler that must not run was called');
};

function responseServer(response: t.Schema) {
  const contract = defineContract({ probe: { method: 'GET', path: '/probe', responses: { 200: response } } });
  const server = createServer();
  server.routes(contract, { probe: neverCalled });
  return server;
}

function bodyServer(body: t.Schema) {
  const contract = defineContract({
    probe: {
      method: 'POST',
      path: '/probe',
      body,
      responses: { 200: t.object({ received: t.boolean() }) },
    },
  });
  const server = createServer();
  server.routes(contract, {
    probe: ({ body: received }) => ({ status: 200, body: { received: received instanceof Secret } }),
  });
  return server;
}

async function listenOutcome(server: ReturnType<typeof responseServer>): Promise<string> {
  try {
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    await server.close();
    return `listen succeeded on port ${port}`;
  } catch (error) {
    return error instanceof BootError ? error.code : `threw ${String(error)}`;
  }
}

async function post(server: ReturnType<typeof bodyServer>, body: unknown): Promise<{ status: number; text: string }> {
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  } finally {
    await server.close();
  }
}

interface Line {
  name: string;
  problems: readonly string[];
}

async function credsLines(derivation: Derivation): Promise<Line[]> {
  const wrapped = derivation.wrapped ?? derivation.schema;
  const [refused, allowed, received] = await Promise.all([
    listenOutcome(responseServer(derivation.schema)),
    listenOutcome(responseServer(wrapped)),
    post(bodyServer(derivation.schema), derivation.valid),
  ]);
  const redacted = redact(derivation.schema, derivation.valid);
  return [
    {
      name: `t.${derivation.name}(creds) as a 200 response makes listen reject with SECRET_IN_RESPONSE`,
      problems: refused === 'SECRET_IN_RESPONSE' ? [] : [`listen gave ${refused}`],
    },
    {
      name: `t.exposed(t.${derivation.name}(creds), reason) as a 200 response lets listen succeed`,
      problems: allowed.startsWith('listen succeeded') ? [] : [`listen gave ${allowed}`],
    },
    {
      name: `t.${derivation.name}(creds) as a body hands the handler a Secret`,
      problems:
        received.status === 200 && received.text === '{"received":true}'
          ? []
          : [`answered ${received.status} ${received.text}`],
    },
    {
      name: `redact of a value against t.${derivation.name}(creds) returns [secret]`,
      problems: redacted === '[secret]' ? [] : [`returned ${JSON.stringify(redacted)}`],
    },
  ];
}

async function personLines(derivation: Derivation): Promise<Line[]> {
  const [control, hostile] = await Promise.all([
    post(bodyServer(derivation.schema), derivation.valid),
    post(bodyServer(derivation.schema), { email: markerValue, [markerKey]: markerValue }),
  ]);
  const problems: string[] = [];
  if (control.status !== 200) {
    problems.push(`the valid body answered ${control.status} ${control.text}`);
  }
  if (hostile.status !== 400) {
    problems.push(`the body with the markers answered ${hostile.status}`);
  }
  if (hostile.text.includes(markerKey)) {
    problems.push('the marker key appears in the 400 body');
  }
  if (hostile.text.includes(markerValue)) {
    problems.push('the marker value appears in the 400 body');
  }
  const redacted = redact(derivation.schema, derivation.valid);
  return [
    {
      name: `400 for a body that is t.${derivation.name}(person) holds neither the marker key nor the marker value`,
      problems,
    },
    {
      name: `redact of a value against t.${derivation.name}(person) returns [personal]`,
      problems: redacted === '[personal]' ? [] : [`returned ${JSON.stringify(redacted)}`],
    },
  ];
}

const lines = [
  ...(await Promise.all(credsDerivations.map(credsLines))).flat(),
  ...(await Promise.all(personDerivations.map(personLines))).flat(),
];
for (const { name, problems } of lines) {
  process.stdout.write(problems.length === 0 ? `pass ${name}\n` : `fail ${name}: ${problems.join('; ')}\n`);
}
process.exitCode = lines.every(({ problems }) => problems.length === 0) ? 0 : 1;
