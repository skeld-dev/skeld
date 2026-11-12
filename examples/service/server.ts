import { once } from 'node:events';
import { createServer } from '@skeld/core/server';
import { tasks } from './tasks.ts';

const server = createServer({ log: { access: true } });
server.register(tasks);

const address = await server.listen({ port: Number(process.env.PORT ?? 3002), host: '127.0.0.1' });
server.log.info('task service listening', { url: address.url });
await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
await server.close();
