import { defineContract } from '@darkstart/core/contract';
import { createServer } from '@darkstart/core/server';
import { Type } from 'typebox';
import { host } from '../values.ts';
import { announceReady, failToStart, parsePort } from './server-command.ts';

const Hello = Type.Object({ hello: Type.String() });

const benchContract = defineContract({
  hello: {
    method: 'GET',
    path: '/',
    responses: { 200: Hello },
  },
  echo: {
    method: 'POST',
    path: '/',
    body: Hello,
    responses: { 200: Hello },
  },
});

const listenCause = (error: unknown): unknown =>
  error instanceof Error && error.cause instanceof Error && 'syscall' in error.cause ? error.cause : error;

const port = parsePort(process.argv.slice(2));
const server = createServer();

server.routes(benchContract, {
  hello: () => ({ status: 200, body: { hello: 'world' } }),
  echo: ({ body }) => ({ status: 200, body }),
});

try {
  const address = await server.listen({ port, host });
  announceReady('darkstart', address.port);
} catch (error) {
  failToStart('darkstart', port, listenCause(error));
}

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
