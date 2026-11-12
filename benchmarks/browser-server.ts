// Does:  Serves the routes the browser-boundary cost readings measure, each beside a plain GET reference.
// Holds: Every route answers one fixed reply, so the readings differ only by the boundary work a route asks for.

import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { announceReady, failToStart, parsePort } from './servers/server-command.ts';
import { browserOrigin, host, publicOrigin } from './values.ts';

const Hello = t.object({ hello: t.string({ maxLength: 64 }) });
const reply = { status: 200, body: { hello: 'world' } } as const;

const plainContract = defineContract({
  plain: { method: 'GET', path: '/plain', responses: { 200: Hello } },
  rawCookie: { method: 'GET', path: '/raw-cookie', responses: { 200: Hello } },
  declaredCookie: {
    method: 'GET',
    path: '/declared-cookie',
    cookies: t.object({ sid: t.string({ maxLength: 64 }) }),
    responses: { 200: Hello },
  },
  redirect: { method: 'GET', path: '/redirect', responses: { 302: null } },
  echo: { method: 'POST', path: '/echo', body: Hello, responses: { 200: Hello } },
});

const corsContract = defineContract({
  cors: { method: 'GET', path: '/cors', responses: { 200: Hello } },
});

const port = parsePort(process.argv.slice(2));
const server = createServer({ publicOrigin });

server.routes(plainContract, {
  plain: () => reply,
  rawCookie: ({ rawCookies }) => ({ status: 200, body: { hello: rawCookies.get('sid') ?? 'none' } }),
  declaredCookie: ({ cookies }) => ({ status: 200, body: { hello: cookies.sid } }),
  redirect: () => ({ status: 302, headers: { location: '/plain' } }),
  echo: ({ body }) => ({ status: 200, body }),
});
server.routes(corsContract, { cors: () => reply }, { cors: { origins: [browserOrigin] } });

try {
  const address = await server.listen({ port, host });
  announceReady('skeld-browser', address.port);
} catch (error) {
  failToStart('skeld-browser', port, error);
}

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
