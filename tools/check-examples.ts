// Does:  Runs the example clients and the auth walkthrough and checks their refusals, logs and shutdown.
// Holds: Each server uses a free loopback port and is closed or killed before the check leaves it.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const root = join(import.meta.dirname, '..');

async function checkExample(name: 'hello' | 'logging' | 'service'): Promise<void> {
  const cwd = join(root, 'examples', name);
  const server = spawn(process.execPath, ['--conditions=skeld-source', name === 'hello' ? 'hello.ts' : 'server.ts'], {
    cwd,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(server, 'close');
  const deadline = setTimeout(() => server.kill('SIGKILL'), 30_000);
  const records: Record<string, unknown>[] = [];
  const parseErrors: unknown[] = [];
  let stderr = '';
  server.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const output = createInterface({ input: server.stdout });
  const ready = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.once('close', () => reject(new Error(`${name} exited before listening: ${stderr}`)));
    output.on('line', (line) => {
      try {
        const record: Record<string, unknown> = JSON.parse(line);
        assert.ok(record !== null && typeof record === 'object' && !Array.isArray(record));
        records.push(record);
        if (record.event_name === 'skeld.server.listening') {
          const port = record['server.port'];
          assert.ok(typeof port === 'number');
          resolve(port);
        }
      } catch (error) {
        parseErrors.push(error);
        reject(error);
      }
    });
  });
  try {
    const baseUrl = `http://127.0.0.1:${await ready}`;
    const client = spawnSync(process.execPath, ['--conditions=skeld-source', 'client.ts'], {
      cwd,
      env: { ...process.env, BASE_URL: baseUrl },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(client.status, 0, `${name} client: ${client.stderr}`);
    const expected = {
      hello: ['Hello, Ada!', 'Olá, Ada'],
      logging: ['Accepted: true; request id:', 'Rejected: INVALID_DOCUMENT; request id:'],
      service: ['Created: Read the contract', 'Read: Read the contract; module: tasks', 'Missing: TASK_NOT_FOUND'],
    };
    for (const line of expected[name]) {
      assert.ok(client.stdout.includes(line), client.stdout);
    }

    const path = name === 'hello' ? '/hello' : name === 'logging' ? '/preview' : '/tasks';
    const invalid =
      name === 'hello'
        ? { name: 'Ada', language: 'xx' }
        : name === 'logging'
          ? { email: 'reader@example.test', apiKey: 'demo', document: '{}', extra: true }
          : { title: '' };
    const refused = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(invalid),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(refused.status, 400);
    const error: unknown = await refused.json();
    assert.ok(typeof error === 'object' && error !== null && 'code' in error && error.code === 'VALIDATION');
    const refusedId = refused.headers.get('x-request-id');
    assert.ok(refusedId);

    if (name === 'service') {
      const statuses = await Promise.all(
        Array.from({ length: 100 }, async () => {
          const response = await fetch(`${baseUrl}/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Capacity example' }),
            signal: AbortSignal.timeout(5000),
          });
          const body: unknown = await response.json();
          if (response.status === 409) {
            assert.ok(typeof body === 'object' && body !== null && 'code' in body && body.code === 'TASK_LIMIT');
          }
          return response.status;
        }),
      );
      assert.equal(statuses.filter((status) => status === 201).length, 99);
      assert.equal(statuses.filter((status) => status === 409).length, 1);
    }

    server.kill('SIGTERM');
    const [code, signal] = await closed;
    assert.equal(signal, null);
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    assert.deepEqual(parseErrors, []);
    assert.ok(records.some((record) => record.event_name === 'skeld.server.closed'));
    const access = records.filter((record) => record.event_name === 'skeld.request.closed');
    if (name === 'hello') {
      assert.equal(access.length, 0);
    } else {
      assert.equal(access.filter((record) => record['skeld.request_id'] === refusedId).length, 1);
      assert.equal(
        records.filter(
          (record) => record['skeld.request_id'] === refusedId && record.event_name === 'skeld.app.message',
        ).length,
        0,
      );
    }
    if (name === 'logging') {
      const text = JSON.stringify(records);
      for (const marker of ['reader@example.test', 'demo-key-only-not-a-credential', 'PRIVATE_DOCUMENT_NOT_JSON']) {
        assert.equal(text.includes(marker), false);
      }
      const previews = records.filter((record) => record.message === 'preview requested');
      assert.equal(previews.length, 2);
      for (const preview of previews) {
        assert.deepEqual(preview.fields, {
          email: '[personal]',
          apiKey: '[secret]',
          input: { email: '[personal]', apiKey: '[secret]', document: '[personal]' },
        });
        const id = preview['skeld.request_id'];
        assert.ok(typeof id === 'string');
        assert.ok(client.stdout.includes(id));
        assert.equal(access.filter((record) => record['skeld.request_id'] === id).length, 1);
      }
      const warning = records.find((record) => record.message === 'document rejected');
      assert.ok(warning);
      assert.deepEqual(warning.fields, { err: { type: 'SyntaxError' } });
    }
    if (name === 'service') {
      assert.deepEqual(records.find((record) => record.message === 'task store cleared')?.fields, { entries: 100 });
      assert.equal(records.filter((record) => record.message === 'task created').length, 100);
    }
    process.stdout.write(`ok ${name}: client, refusal, logs and graceful close\n`);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
    }
    await closed;
    clearTimeout(deadline);
    output.close();
  }
}

// Does:  Runs the auth example's own walkthrough script, which picks its port before start since auth needs its origin.
function checkAuthWalkthrough(): void {
  const cwd = join(root, 'examples', 'auth');
  const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(openssl.status, 0, 'auth: the walkthrough needs openssl on the PATH for its local certificate');
  const manifest: unknown = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  assert.ok(typeof manifest === 'object' && manifest !== null && 'scripts' in manifest);
  const { scripts } = manifest;
  assert.ok(typeof scripts === 'object' && scripts !== null && 'walkthrough' in scripts);
  const { walkthrough } = scripts;
  assert.ok(typeof walkthrough === 'string');
  const [command, ...args] = walkthrough.split(' ');
  assert.equal(command, 'node', `auth: the walkthrough script is not a node command: ${walkthrough}`);
  // Why: The walkthrough starts an HTTPS provider, two databases and about 90 checks; 120 s allows a loaded host.
  const run = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.signal, null, `auth walkthrough killed by ${run.signal}: ${run.stderr}`);
  assert.equal(run.status, 0, `auth walkthrough: ${run.stdout}${run.stderr}`);
  assert.ok(run.stdout.trimEnd().endsWith('walkthrough passed'), run.stdout);
  const checks = run.stdout.split('\n').filter((line) => line.startsWith('  ok  ')).length;
  process.stdout.write(`ok auth: walkthrough passed, ${checks} checks\n`);
}

await checkExample('hello');
await checkExample('logging');
await checkExample('service');
checkAuthWalkthrough();
