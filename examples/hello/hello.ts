import { once } from 'node:events';
import { createServer } from '@skeld/core/server';
import { helloContract } from './contract.ts';

const server = createServer();
server.routes(helloContract, {
  greet: ({ params, query }) => ({
    status: 200,
    body: { message: `Hello, ${params.name}${query.excited === true ? '!' : ''}` },
  }),
  greetInLanguage: ({ body }) => ({
    status: 200,
    body: { message: `${body.language === 'pt' ? 'Olá' : 'Hello'}, ${body.name}` },
  }),
});

await server.listen({ port: 3000, host: '127.0.0.1' });
server.log.info('hello listening', { url: 'http://127.0.0.1:3000' });

await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
server.log.info('hello stopping');
await server.close();
