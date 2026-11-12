import { once } from 'node:events';
import { createServer } from '@skeld/core/server';
import { previewContract } from './contract.ts';

const server = createServer({ log: { access: true } });
server.routes(previewContract, {
  preview: (request) => {
    request.log.info('preview requested', {
      email: request.classified('body', 'email'),
      apiKey: request.body.apiKey,
      input: request.classified('body'),
    });
    try {
      JSON.parse(request.body.document);
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        throw err;
      }
      request.log.warn('document rejected', { err });
      return { status: 422, body: { code: 'INVALID_DOCUMENT' } };
    }
    return { status: 200, body: { accepted: true } };
  },
});

const address = await server.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });
server.log.info('preview listening', { url: address.url });
await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
await server.close();
