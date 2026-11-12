// Does:  Proves audit route identity, option ownership and classified-path diagnostic boundaries.
// Holds: Assertions inspect actual client/server exchanges and isolated diagnostic output files.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@darkstart/core/client';
import { defineContract } from '@darkstart/core/contract';
import { HttpError } from '@darkstart/core/http-error';
import * as t from '@darkstart/core/schema';
import { createServer } from '@darkstart/core/server';
import { startServerChild } from './support-typesystem.ts';

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
  for (const path of ['/', '/dot.name', '/.../x', '/café/日本', '/a+b', '/a:b', '/semi;colon', '/at@sign']) {
    const contract = defineContract({ item: { method: 'GET', path, responses: { 204: null } } });
    const server = createServer();
    let calls = 0;
    server.routes(contract, {
      item: () => {
        calls += 1;
        return { status: 204 };
      },
    });
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests preserve diagnostic attribution.
    const { port } = await server.listen({ host: '127.0.0.1', port: 0 });
    try {
      assert.equal((await createClient(contract, { baseUrl: `http://127.0.0.1:${port}` }).item()).status, 204);
      assert.equal(calls, 1, path);
    } finally {
      await server.close();
    }
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
  } finally {
    await child.stop();
  }
  const stderr = child.stderr();
  assert(stderr.includes('/:token'), stderr);
  assert(!stderr.includes(token), stderr);
}

async function diagChild(): Promise<void> {
  const server = createServer();
  for (const key of ['a', 'b']) {
    server.register((scope) => {
      const contract = defineContract({
        get: { method: 'GET', path: `/${key}`, responses: { 200: t.object({ [key]: t.boolean() }) } },
      });
      scope.routes(contract, { get: () => ({ status: 200, body: { [key]: true } }) });
    });
  }
  const { port } = await server.listen({ host: '127.0.0.1', port: 0 });
  try {
    for (const key of ['a', 'b', 'b']) {
      // biome-ignore lint/performance/noAwaitInLoops: Serial requests preserve diagnostic attribution.
      const res = await fetch(`http://127.0.0.1:${port}/${key}`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { [key]: true });
    }
  } finally {
    await server.close();
  }
}

function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

async function diagnosticIdentity(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'darkstart-audit-routes-'));
  const child = spawnSync(
    process.execPath,
    ['--conditions=darkstart-source', '--conditions=darkstart-diag', script, 'diag'],
    {
      env: { ...process.env, DARKSTART_DIAG_DIR: dir, DARKSTART_DIAG_STEP_N: '1' },
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
  assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
  const run = record(JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')));
  assert.equal(run.format, 'darkstart-diag/2');
  assert(Array.isArray(run.routes));
  assert.equal(run.routes.length, 2);
  const routes = run.routes.map((value: unknown) => record(value));
  assert.deepEqual(
    routes.map((route) => route.name),
    ['get', 'get'],
  );
  assert.notEqual(routes[0]?.id, routes[1]?.id);
  const lines = (await readFile(join(dir, 'snapshot.jsonl'), 'utf8')).trim().split('\n');
  const last = record(JSON.parse(lines.at(-1) ?? 'null'));
  const counts = record(last.counts);
  for (const route of routes) {
    assert.equal(counts[`req.count{${String(route.id)}}`], route.path === '/a' ? 1 : 2);
  }
  assert.deepEqual(last.failing, []);
  process.stdout.write(`diagnostic evidence ${dir}\n`);
}

if (process.argv[2] === 'serve') {
  await serve();
} else if (process.argv[2] === 'diag') {
  await diagChild();
} else {
  await routeForms();
  await inheritedOptions();
  await clientErrors();
  await serverErrors();
  await diagnosticIdentity();
  process.stdout.write(
    'pass audit boundaries: route identity, prototype names, classified diagnostics and duplicate-name recorder\n',
  );
}
