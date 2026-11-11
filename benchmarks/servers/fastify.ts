// Does:  Serves the hello and echo routes with Fastify, the server the verdict compares against.
// Holds: It serves the same two routes with the same bodies as every other server here.

import fastify from 'fastify';
import { host } from '../values.ts';
import { announceReady, failToStart, parsePort } from './server-command.ts';

const helloSchema = { type: 'object', properties: { hello: { type: 'string' } } } as const;
const echoBodySchema = {
  type: 'object',
  properties: { hello: { type: 'string' } },
  required: ['hello'],
  additionalProperties: false,
} as const;

const port = parsePort(process.argv.slice(2));
const app = fastify({ logger: false });

app.get('/', { schema: { response: { 200: helloSchema } } }, (_request, reply) => {
  reply.send({ hello: 'world' });
});

app.post('/', { schema: { body: echoBodySchema, response: { 200: helloSchema } } }, (request, reply) => {
  // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- echo route: Fastify serializes the parsed JSON body with the response schema as application/json
  reply.send(request.body);
});

app.listen({ port, host }, (error) => {
  if (error !== null) {
    failToStart('fastify', port, error);
  }
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    failToStart('fastify', port, new Error('the server has no TCP address'));
  }
  announceReady('fastify', address.port);
});

const stop = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
