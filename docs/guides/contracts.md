# Design a contract

A contract is the public shape of a service: named routes, accepted request parts, and responses by status. Keep it separate from database connections, handlers, and server startup so clients can import it without importing the server.

The [task service contract](../../examples/service/contract.ts) is a complete example. It declares `create` and `get`; the [plugin](../../examples/service/tasks.ts) implements them.

## Bound data where it enters

Choose limits from the operation's needs. A task title is 1–120 UTF-16 code units, so its schema is `t.string({ minLength: 1, maxLength: 120 })`. A required field can still contain an empty string unless you set a minimum.

| Shape      | Required upper bound | What the bound counts                                        |
| ---------- | -------------------- | ------------------------------------------------------------ |
| `t.string` | `maxLength`          | UTF-16 code units, as in JavaScript's `value.length`         |
| `t.array`  | `maxItems`           | Array elements                                               |
| `t.record` | `maxProperties`      | Properties; key and value schemas have their own constraints |

Each also accepts `unbounded: '<reason>'` instead of an upper bound. The reason makes an exception explicit; it does not impose a replacement limit. A request body still has a byte cap, but that cap does not bound retained application state or the cost of your database query.

Skeld derives a body byte limit from bounded schemas and applies the smaller of that limit and the configured `bodyLimit`. An `open` or `unbounded` node removes the derived limit for that body; the configured cap remains. This is why a small route can return 413 before it reaches the server's default 1 MiB cap. See the [exact sizing rules](../../packages/core/README.md#bounds-and-their-opt-outs).

## Decide what extra fields mean

Objects are closed by default. An undeclared key in a JSON request body is a 400 validation failure, including inside nested objects. Use this to catch misspelled fields and prevent callers from adding inputs that an operation never intended to accept.

An object declared with `{ open: '<reason>' }` accepts undeclared keys and drops them before the handler receives the value. It does not hand the handler an arbitrary property bag. Query and header roots already ignore undeclared names, so unrelated HTTP headers do not make every request fail.

## Choose response fields explicitly

Prefer a response allowlist derived with `t.pick`. This keeps a field added to an internal model from becoming public merely because it was not in yesterday's omit list.

```ts
import * as t from '@skeld/core/schema';

export const Account = t.object({
  id: t.string({ maxLength: 36 }),
  displayName: t.string({ maxLength: 80 }),
  email: t.string({ maxLength: 254, sensitivity: 'personal' }),
  apiKey: t.string({ maxLength: 128, sensitivity: 'secret' }),
});

export const PublicAccount = t.pick(Account, ['id', 'displayName']);
export const UpdateAccount = t.partial(t.pick(Account, ['displayName']), { minProperties: 1 });
```

`UpdateAccount` accepts a display-name update and refuses an empty object. Composition preserves field bounds and sensitivity. Whether the current caller may update that account is still an authorization decision in your application.

For an ordinary object response, the serializer writes declared fields and omits undeclared ones. A declared field with an invalid value becomes a fixed 500 response, rather than being sent unchecked.

**Union responses need a deliberate projection.** A union must match a member before serialization. Its closed object members reject extra fields, so returning a database row with undeclared properties can produce a response mismatch instead of dropping those properties. Return the fields of the intended member explicitly. See [union responses](../../packages/core/README.md#union-responses).

## Declare expected outcomes

The task service declares creation as HTTP 201 and a full store as HTTP 409. Both are useful outcomes a client should handle. Its read operation declares HTTP 200 and HTTP 404 for a missing task. They do not need exceptions to express ordinary control flow.

Use `errorBodySchema` when an application outcome uses the standard `{ status, code, message, details? }` error shape. A route may instead declare a different body for its own error status, as the [logging example](../../examples/logging/contract.ts) does for HTTP 422.

Declaring those outcomes does not eliminate framework refusals: malformed input, oversized bodies, or a timeout can still produce other statuses. The client represents undeclared response bodies as `unknown`.

## Treat a contract change as an API change

The server and a browser may run different releases. Sharing a source file during development does not update an already deployed client. Tightening an input bound can reject existing callers; adding a required response field can make a newer client reject an older server.

Plan compatible deployment order or version the operation when necessary. Keep example requests and the corresponding client behavior in the same review as the contract change.

**Next:** [call a service and handle errors](client-and-errors.md). Reference: [schema](../api/core/schema.md) and [contract](../api/core/contract.md).
