// Does:  Serves the hello and echo routes with Hono, for comparison.
// Holds: It serves the same two routes with the same bodies as every other server here.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { host } from '../values.ts';
import { announceReady, failToStart, parsePort } from './server-command.ts';

const port = parsePort(process.argv.slice(2));
const app = new Hono();

app.get('/', (c) => c.json({ hello: 'world' }));

app.post('/', async (c) => c.json(await c.req.json<{ hello: string }>()));

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  announceReady('hono', info.port);
});

server.once('error', (error) => {
  failToStart('hono', port, error);
});

const stop = (): void => {
  server.close(() => {
    process.exit(0);
  });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
