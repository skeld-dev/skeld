// Does:  Proves route path forms, option ownership and that a classified path value reaches no message or log record.
// Holds: Assertions inspect actual client and server exchanges, error messages and log records.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import { HttpError } from '@skeld/core/http-error';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { parseRecords, untilStdout } from '../support/support-log.ts';
import { startServerChild } from '../support/support-typesystem.ts';

const script = fileURLToPath(import.meta.url);
const token = 'CLASSIFIED_PATH_MARKER_628317';
const response = t.object({ ok: t.boolean() });

function classified(sensitivity: 'secret' | 'personal', path = '/reset/:token') {
  return defineContract({
    reset: {
      method: 'GET',
      path,
      params: t.object({ [path.endsWith('/*') ? '*' : 'token']: t.string({ maxLength: 64, sensitivity }) }),
      responses: { 200: response },
    },
  });
}

async function clientErrors(): Promise<void> {
  const cases: readonly [string, typeof fetch][] = [
    ['NETWORK', () => Promise.reject(new Error('network unavailable'))],
    [
      'NETWORK',
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('read failed'));
            },
          }),
        ),
    ],
    ['INVALID_RESPONSE', async () => new Response('{', { headers: { 'content-type': 'application/json' } })],
    ['INVALID_RESPONSE', async () => Response.json({ ok: 'wrong' })],
    ['RESPONSE_TOO_LARGE', async () => new Response('x'.repeat(1025))],
    [
      'INVALID_RESPONSE',
      async () =>
        new Response(`${'['.repeat(65)}0${']'.repeat(65)}`, { headers: { 'content-type': 'application/json' } }),
    ],
    [
      'INVALID_RESPONSE',
      async () => new Response('{', { status: 418, headers: { 'content-type': 'application/json' } }),
    ],
  ];
  for (const sensitivity of ['secret', 'personal'] as const) {
    for (const [code, fetcher] of cases) {
      const client = createClient(classified(sensitivity), {
        baseUrl: 'https://example.test/prefix',
        fetch: fetcher,
        maxResponseBytes: 1024,
      });
      // biome-ignore lint/performance/noAwaitInLoops: Serial requests preserve diagnostic attribution.
      await assert.rejects(client.reset({ params: { token } }), (error: unknown) => {
        assert(error instanceof HttpError);
        assert.equal(error.code, code);
        assert(!error.message.includes(token));
        assert(error.message.includes('/reset/:token'));
        return true;
      });
    }
  }
}

async function routeForms(): Promise<void> {
  for (const path of ['/users/../admin', '/a/./b', '/a\\b', '/..', '/.']) {
    assert.throws(() => defineContract({ item: { method: 'GET', path, responses: { 204: null } } }), TypeError);
  }
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    const contract = defineContract({ [name]: { method: 'GET', path: '/prototype', responses: { 204: null } } });
    const server = createServer();
    server.routes(contract, { [name]: () => ({ status: 204 }) });
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests preserve diagnostic attribution.
    const { port } = await server.listen({ host: '127.0.0.1', port: 0 });
    try {
      assert.equal((await fetch(`http://127.0.0.1:${port}/prototype`)).status, 204, name);
    } finally {
      await server.close();
    }
  }
}

async function inheritedOptions(): Promise<void> {
  const contract = defineContract({ item: { method: 'GET', path: '/own', responses: { 204: null } } });
  const server = createServer();
  const limits = Object.create({ item: -1 });
  server.routes(contract, { item: () => ({ status: 204 }) }, { bodyLimits: limits, handlerTimeouts: limits });
  const { port } = await server.listen({ host: '127.0.0.1', port: 0 });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/own`)).status, 204);
  } finally {
    await server.close();
  }
  const missing = createServer();
  assert.throws(() => missing.routes(contract, Object.create({ item: () => ({ status: 204 }) })), /has no handler/);
}

async function serve(): Promise<void> {
  const server = createServer({ handlerTimeoutMs: 50 });
  for (const sensitivity of ['secret', 'personal'] as const) {
    for (const mode of ['throw', 'hook', 'observer', 'timeout', 'late', 'errorhook', 'wildcard']) {
      server.register((scope) => {
        const contract = classified(sensitivity, `/${sensitivity}/${mode}/${mode === 'wildcard' ? '*' : ':token'}`);
        if (mode === 'hook') {
          scope.addHook('preHandler', () => {
            throw new Error('hook failure');
          });
        }
        if (mode === 'observer') {
          scope.addHook('onResponse', () => {
            throw new Error('observer failure');
          });
        }
        if (mode === 'errorhook') {
          scope.addHook('onError', () => {
            throw new Error('error hook failure');
          });
        }
        if (mode === 'late') {
          scope.addHook('onRequest', (context) => {
            context.send({ status: 200, payload: '{"ok":true}' });
            context.send({ status: 200, payload: '{"ok":true}' });
          });
        }
        scope.routes(contract, {
          reset: () => {
            if (mode === 'throw' || mode === 'errorhook' || mode === 'wildcard') {
              throw new Error('handler failure');
            }
            if (mode === 'timeout') {
              return new Promise<never>(() => undefined);
            }
            return { status: 200, body: { ok: true } };
          },
        });
      });
    }
  }
  const { port } = await server.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(`listening ${port}\n`);
}

async function serverErrors(): Promise<void> {
  const child = await startServerChild(script);
  try {
    for (const sensitivity of ['secret', 'personal']) {
      for (const mode of ['throw', 'hook', 'observer', 'timeout', 'late', 'errorhook', 'wildcard']) {
        // biome-ignore lint/performance/noAwaitInLoops: Serial requests preserve diagnostic attribution.
        const res = await fetch(`http://127.0.0.1:${child.port}/${sensitivity}/${mode}/${token}`);
        assert.equal(
          res.status,
          mode === 'timeout' ? 503 : ['throw', 'hook', 'errorhook', 'wildcard'].includes(mode) ? 500 : 200,
        );
        assert(!(await res.text()).includes(token));
      }
    }
    await untilStdout(child, (found) =>
      ['secret', 'personal'].every((sensitivity) =>
        found.some((candidate) => candidate?.['http.route'] === `/${sensitivity}/wildcard/*`),
      ),
    );
  } finally {
    await child.stop();
  }
  const stderr = child.stderr();
  const stdout = child.stdout();
  const records = parseRecords(stdout);
  const expected: readonly (readonly [string, string])[] = [
    ['throw', 'skeld.request.error thrown'],
    ['hook', 'skeld.request.error thrown'],
    ['observer', 'skeld.hook.error on_response'],
    ['timeout', 'skeld.request.error timeout'],
    ['late', 'skeld.hook.error late_send'],
    ['errorhook', 'skeld.hook.error on_error'],
    ['wildcard', 'skeld.request.error thrown'],
  ];
  for (const sensitivity of ['secret', 'personal']) {
    for (const [mode, event] of expected) {
      const route = mode === 'wildcard' ? `/${sensitivity}/${mode}/*` : `/${sensitivity}/${mode}/:token`;
      assert(
        records.some(
          (candidate) =>
            `${candidate?.event_name} ${candidate?.['skeld.reason']}` === event && candidate?.['http.route'] === route,
        ),
        `no ${event} record for ${route} on stdout: ${stdout}`,
      );
    }
  }
  assert(!stderr.includes(token), stderr);
  assert(!stdout.includes(token), stdout);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await routeForms();
  await inheritedOptions();
  await clientErrors();
  await serverErrors();
  process.stdout.write('pass audit boundaries: route forms, prototype names and classified path values\n');
}
