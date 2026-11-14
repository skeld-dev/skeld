# Install skeld

Add `@skeld/core` to a new project, run a one-route service, and call it through its contract. You need Node.js 26.12 or later and npm. Check your version with `node --version`.

## Create a project

```sh
mkdir hello-skeld
cd hello-skeld
npm init -y
npm pkg set type=module
npm install @skeld/core
```

skeld requires an ES module project, which `npm pkg set type=module` declares. The package has no runtime dependencies, so npm adds one package.

## Write the contract, server and client

Save these three files in `hello-skeld`.

`contract.ts` names the route and declares its input and its response. The server and the client both import it.

```ts
import { defineContract } from '@skeld/core/contract';
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
```

`server.ts` implements the route under its contract name and listens until you press Ctrl-C.

```ts
import { once } from 'node:events';
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
await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
await server.close();
```

`client.ts` calls the route by name. It repeats neither the method nor the path.

```ts
import { createClient } from '@skeld/core/client';
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
```

## Run it

Node runs the TypeScript files directly; there is no build step.

```sh
node server.ts
```

The server writes one JSON log line whose `event_name` is `skeld.server.listening`. Leave it running. In a second terminal, from the same folder:

```sh
node client.ts
```

The client prints:

```text
Hello, Ada!
```

## Send input the contract refuses

The contract limits `name` to 64 characters. Request a 65-character name:

```sh
curl http://127.0.0.1:3000/hello/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

The server answers HTTP 400 before the handler runs:

```text
{"status":400,"code":"VALIDATION","message":"Request validation failed","details":[{"path":"/params/name","message":"must have at most 64 UTF-16 code units"}]}
```

## If the server does not start

When another process already uses port 3000, `node server.ts` exits with:

```text
BootError: Cannot listen on 127.0.0.1:3000: EADDRINUSE (address already in use)
```

Change `3000` to a free port in both `server.ts` and `client.ts`.

`@skeld/core/server` needs Node.js 26.12 or later. The contract, schema and client entry points also run on Node.js 22 and in browsers; see [where each subpath runs](../reference/core.md#where-each-subpath-runs).

## Check the types

Running a file with `node` does not type-check it. Add TypeScript and the Node.js types:

```sh
npm install --save-dev typescript @types/node
```

Save this as `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "esnext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  }
}
```

Then run the compiler:

```sh
npx tsc
```

It prints nothing when the three files agree with the contract. Change `name: 'Ada'` to `name: 42` in `client.ts` and it reports:

```text
client.ts(9,13): error TS2322: Type 'number' is not assignable to type 'string'.
```

## Next

- [Your first request](first-request.md) walks through a larger example in the repository: two routes, a request body, and the difference between validation and application behavior.
- [Design a contract](contracts.md) covers bounds, response fields and declared errors.
