// Does:  Serves one fixed contract on the core source under the root named by argv and prints what the wire answers.
// Holds: It reads nothing of the candidate's gate: the same script runs on the previous commit and on the working tree.

import { pathToFileURL } from 'node:url';
import { rawExchange } from '../../support/support.ts';

type Fn = (...args: unknown[]) => unknown;
type Module = Record<string, Fn>;

const root = process.argv[2] ?? '';
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

const ignored = new Set(['date', 'x-request-id']);
const out: Record<string, unknown>[] = [];
for (const [name, request] of probes) {
  // biome-ignore lint/performance/noAwaitInLoops: the probes run one after another
  const response = await rawExchange(port, request, 2000);
  const lines = response.raw
    .split('\r\n\r\n')[0]
    ?.split('\r\n')
    .filter((line, index) => index === 0 || !ignored.has(line.split(':')[0]?.toLowerCase() ?? ''))
    .sort();
  out.push({ name, status: response.status, head: lines, body: response.body });
}
await Promise.resolve(call(server, 'close'));
process.stdout.write(`${JSON.stringify(out)}\n`);
