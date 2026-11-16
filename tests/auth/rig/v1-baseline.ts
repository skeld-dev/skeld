// Does:  Checks sixteen non-gated wire responses against fixed expectations.
// Holds: A committed regression fails without requiring a previous checkout or comparing HEAD to itself.

import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { rawExchange } from '../../support/support.ts';

type Fn = (...args: unknown[]) => unknown;
type Module = Record<string, Fn>;

const root = fileURLToPath(new URL('../../..', import.meta.url));
const load = async (path: string): Promise<Module> => {
  const loaded: Module = await import(pathToFileURL(`${root}/packages/core/src/${path}`).href);
  return loaded;
};
const call = (target: unknown, name: string, ...args: unknown[]): unknown => {
  const member: unknown = Reflect.get(Object(target), name);
  if (typeof member !== 'function') {
    throw new TypeError(`${name} is not a function`);
  }
  return Reflect.apply(member, target, args);
};

const contract = await load('contract/contract.ts');
const schema = await load('schema/schema.ts');
const serverModule = await load('server/server.ts');
const text = (maxLength: number): unknown => schema.string?.({ maxLength });
const routes = contract.defineContract?.({
  ok: { method: 'GET', path: '/ok', responses: { 200: schema.object?.({ ok: text(8) }) } },
  item: {
    method: 'GET',
    path: '/item/:id',
    params: schema.object?.({ id: text(16) }),
    query: schema.object?.({ page: schema.optional?.(text(8)) }),
    responses: { 200: schema.object?.({ id: text(16) }) },
  },
  echo: {
    method: 'POST',
    path: '/echo',
    body: schema.object?.({ name: text(8) }),
    responses: { 200: schema.object?.({ name: text(8) }) },
  },
  boom: { method: 'GET', path: '/boom', responses: { 200: schema.object?.({ ok: text(8) }) } },
});
const server = serverModule.createServer?.({ log: false, publicOrigin: 'http://127.0.0.1', csrf: { mode: 'strict' } });
call(server, 'routes', routes, {
  ok: () => ({ status: 200, body: { ok: 'y' } }),
  item: (request: { params: { id: string } }) => ({ status: 200, body: { id: request.params.id } }),
  echo: (request: { body: { name: string } }) => ({ status: 200, body: { name: request.body.name } }),
  boom: () => {
    throw new Error('boom');
  },
});
const address = await Promise.resolve(call(server, 'listen', { host: '127.0.0.1', port: 0 }));
const port = Number(Reflect.get(Object(address), 'port'));

const probes: [string, string][] = [
  ['get ok', 'GET /ok HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['head ok', 'HEAD /ok HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['get missing', 'GET /missing HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['wrong method', 'DELETE /ok HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['options', 'OPTIONS /ok HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['params and query', 'GET /item/abc?page=2 HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['query invalid', 'GET /item/abc?page=toolongvalue HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['bad escape', 'GET /item/%zz HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  ['throwing handler', 'GET /boom HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n'],
  [
    'post valid',
    'POST /echo HTTP/1.1\r\nhost: x\r\nconnection: close\r\norigin: http://127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: 14\r\n\r\n{"name":"ann"}',
  ],
  [
    'post invalid body',
    'POST /echo HTTP/1.1\r\nhost: x\r\nconnection: close\r\norigin: http://127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: 7\r\n\r\n{"x":1}',
  ],
  [
    'post cross-site',
    'POST /echo HTTP/1.1\r\nhost: x\r\nconnection: close\r\norigin: http://other.example\r\ncontent-type: application/json\r\ncontent-length: 14\r\n\r\n{"name":"ann"}',
  ],
  [
    'post with no origin and no fetch metadata',
    'POST /echo HTTP/1.1\r\nhost: x\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: 14\r\n\r\n{"name":"ann"}',
  ],
  ['two hosts', 'GET /ok HTTP/1.1\r\nhost: x\r\nhost: y\r\nconnection: close\r\n\r\n'],
  ['bearer header is ignored', 'GET /ok HTTP/1.1\r\nhost: x\r\nconnection: close\r\nauthorization: Bearer abc\r\n\r\n'],
  ['session cookie is ignored', 'GET /ok HTTP/1.1\r\nhost: x\r\nconnection: close\r\ncookie: __Host-skeld=abc\r\n\r\n'],
];

const expected = [200, 200, 404, 404, 404, 200, 400, 400, 500, 200, 400, 403, 403, 400, 200, 200];
try {
  for (const [index, [name, request]] of probes.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: a failure identifies its exact wire probe
    const response = await rawExchange(port, request, 2000);
    assert.equal(response.status, expected[index], name);
    if (name === 'head ok') {
      assert.equal(response.body, '', name);
    } else if (response.status === 200) {
      const body = name === 'params and query' ? { id: 'abc' } : name === 'post valid' ? { name: 'ann' } : { ok: 'y' };
      assert.deepEqual(JSON.parse(response.body), body, name);
    } else if (name !== 'two hosts') {
      const body = JSON.parse(response.body);
      assert.equal(body.status, response.status, name);
      assert.equal(typeof body.code, 'string', name);
      assert.equal(Object.hasOwn(body, 'stack'), false, name);
      if (name === 'throwing handler') {
        assert.equal(response.body.includes('boom'), false, name);
      }
    }
  }
  process.stdout.write(`${probes.length} fixed wire expectations passed\n`);
} finally {
  await Promise.resolve(call(server, 'close'));
}
