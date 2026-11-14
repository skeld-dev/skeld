// Does:  Supplies the complete source files shown and downloaded by the first-route section.
// Holds: These are example strings; the website never imports or executes skeld core.

export const firstRouteFiles = [
  {
    name: 'contract.ts',
    title: 'Declare the API.',
    description: 'Name the route and define its inputs and responses. The server and client both import this contract.',
    note: 'The name is bounded at 64 characters. The greeting has room for the added text.',
    source: `import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

export const contract = defineContract({
  greet: {
    method: 'GET',
    path: '/hello/:name',
    params: t.object({
      name: t.string({ maxLength: 64 }),
    }),
    responses: {
      200: t.object({
        message: t.string({ maxLength: 72 }),
      }),
    },
  },
});
`,
  },
  {
    name: 'server.ts',
    title: 'Write the handler.',
    description: 'Implement the named route. The contract supplies the handler types and checks the data at runtime.',
    note: 'skeld checks the routes before listening. Ctrl-C closes this example server.',
    source: `import { once } from 'node:events';
import { createServer } from '@skeld/core/server';
import { contract } from './contract.ts';

const server = createServer();
server.routes(contract, {
  greet: ({ params }) => ({
    status: 200,
    body: { message: 'Hello, ' + params.name + '!' },
  }),
});

await server.listen({ host: '127.0.0.1', port: 3000 });
await Promise.race([
  once(process, 'SIGINT'), once(process, 'SIGTERM'),
]);
await server.close();
`,
  },
  {
    name: 'client.ts',
    title: 'Call it by name.',
    description:
      'Use the same contract to create the client. Declared JSON responses are checked before your code receives them.',
    note: 'Narrow by status to use the declared response. An undeclared status has an unknown body.',
    source: `import { createClient } from '@skeld/core/client';
import { contract } from './contract.ts';

const client = createClient(contract, {
  baseUrl: 'http://127.0.0.1:3000',
});

const reply = await client.greet({
  params: { name: 'Ada' },
});

if (reply.status === 200) {
  console.log(reply.body.message);
}
`,
  },
];
