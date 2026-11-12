# A small service with a feature scope

This task service creates and reads tasks. It keeps at most 100 in memory and clears them at shutdown. It has no authentication or durable storage; it is a local example of organizing the core APIs.

From the repository root, after `npm install`:

```sh
npm run start --workspace @skeld/example-service
```

In a second terminal:

```sh
npm run call --workspace @skeld/example-service
```

On a fresh server, the client prints:

```text
Created: Read the contract
Read: Read the contract; module: tasks
Missing: TASK_NOT_FOUND
```

## Where each responsibility lives

| File                       | Responsibility                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| [contract.ts](contract.ts) | Request/response schemas and a `Task` type derived from its schema   |
| [tasks.ts](tasks.ts)       | A plugin owning the store, route handlers, scoped hook and cleanup   |
| [server.ts](server.ts)     | Server options, plugin registration, listening and graceful shutdown |
| [client.ts](client.ts)     | Calls from the shared contract, with status-based response narrowing |

The handlers stay together inside the small feature plugin. As the feature grows, extract its domain operations without moving the contract into the server's implementation or giving clients access to the store.

## Bound the work and the data

The request schema requires a title of 1–120 characters and refuses extra keys. The store admits 100 tasks; the next creation returns declared HTTP 409 `TASK_LIMIT`. This bounds retained state even when each individual request is valid. The check and insertion are synchronous; if moving them across an `await` or to a database, enforce capacity atomically there. Restart the example to reset it.

An unknown task ID returns declared HTTP 404 `TASK_NOT_FOUND`. Both errors use `errorBodySchema` and fixed messages. The client handles statuses explicitly; an undeclared response body has type `unknown`. Transport and invalid-response failures reject the client call.

The title is application data returned by this API; the example does not log it. Only the generated task ID is passed to the author logger. Do not treat this demonstration contract as a policy for confidential user tasks: classification and authorization depend on who is permitted to see them.

## Hooks and lifetime belong to the scope

`server.register(tasks)` creates a child scope. Its `onRequest` hook sets `x-example-module: tasks` for its routes; it is an application header, not an access control. Child hooks do not become global hooks for sibling plugins. Engine error responses may clear author headers, so do not rely on this header being present on refusals.

`scope.onClose` is registered next to the store's creation. Ctrl-C drains HTTP work, clears the store and writes `task store cleared`, then finishes the server's close and log flush. A real plugin would register its connection or resource disposer at acquisition in the same way; callbacks can also run during failed-startup rollback. See [plugin cleanup](../../packages/core/README.md#plugin-resource-ownership) for deadlines and cooperative cancellation.

## Try a refused request

```sh
curl -i http://127.0.0.1:3002/tasks \
  -H 'content-type: application/json' \
  --data '{"title":""}'
```

Expect HTTP 400 `VALIDATION`, a request ID and an access record, with no `task created` record for that request. No task is inserted. Compare that with a valid-but-missing lookup:

```sh
curl -i http://127.0.0.1:3002/tasks/00000000-0000-0000-0000-000000000000
```

Expect HTTP 404 `TASK_NOT_FOUND` from the handler. These two outcomes show the difference between input refusal and a declared application outcome.

Use the [logging example](../logging/README.md) for classified data and caught errors, and the [examples guide](../README.md) for ports and verification commands.
