import { App, type Context, json } from '@lightstart/server';
import { type NodeServer, serve } from '@lightstart/server/node';
import { host } from '../values.ts';
import { announceReady, failToStart, parsePort } from './server-command.ts';

interface Hello {
  readonly hello: string;
}

const helloOf = (value: unknown): Hello | null =>
  typeof value === 'object' && value !== null && 'hello' in value && typeof value.hello === 'string'
    ? { hello: value.hello }
    : null;

const port = parsePort(process.argv.slice(2));

const app = new App()
  .get('/', () => json({ hello: 'world' }))
  .post('/', async (c: Context) => {
    const body = helloOf(await c.json());
    return body === null ? json({ status: 400, code: 'BAD_REQUEST' }, 400) : json(body);
  });

const start = async (): Promise<NodeServer> => {
  try {
    return await serve(app, { port, host });
  } catch (error) {
    return failToStart('light', port, error);
  }
};

const server = await start();
announceReady('light', server.port);

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
