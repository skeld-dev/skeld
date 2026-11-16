# @skeld/core/gate

## AccessTypes

What a gate tells the server's types: the principal it admits and the grant of each policy action.

```ts
export interface AccessTypes {
  readonly principal: unknown;
  readonly grants: { readonly [policy: string]: { readonly [action: string]: unknown } };
}
```

| Field       | Summary                                                       |
| ----------- | ------------------------------------------------------------- |
| `principal` | The principal a credential resolves to.                       |
| `grants`    | The grant a handler receives, by policy name and action name. |

Source: `packages/core/src/gate/types.ts:9`

## AuthorizeOutcome

What `authorize` answers; the server passes the grant to the handler by identity, never copied or wrapped.

An admit whose `grant` is missing or `undefined` is a fault, answered with the fixed 500.

```ts
export type AuthorizeOutcome =
  | {
      readonly kind: 'admit';
      readonly grant: unknown;
    }
  | GateRefusal;
```

| Field   | Summary                                            |
| ------- | -------------------------------------------------- |
| `kind`  | Whether the request is admitted or refused.        |
| `grant` | The grant the handler receives as `request.grant`. |

Source: `packages/core/src/gate/types.ts:141`

## Gate

The access control of one server: booted once at `listen`, then bound to every route.

`listen` rejects with BootError `GATE_FAILED` when `boot` fails and `ACCESS_REFUSED` when `bind` returns a finding.

```ts
export interface Gate<A extends AccessTypes> {
  boot(context: GateBoot): void | Promise<void>;
  bind(route: GateRoute): RouteGate<A['principal']> | GateFinding | null;
  readonly '~access'?: A;
}
```

| Field     | Summary                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| `boot`    | Prepares the gate once at `listen`, after the plugins settle; a `GateFault` names the cause.                   |
| `bind`    | Binds one route, synchronously: a `RouteGate`, a finding that refuses the route, or `null` for a public route. |
| `~access` | Carries the access types to the server's types; never read at runtime.                                         |

Source: `packages/core/src/gate/types.ts:30`

## GateBoot

What `Gate.boot` receives: the root scope's log, signal and disposer stack, and the security-event registry.

```ts
export interface GateBoot {
  readonly log: Logger;
  readonly signal: AbortSignal;
  onClose(callback: () => void | Promise<void>): void;
  readonly closeTimeoutMs: number;
  readonly publicOrigin: readonly string[];
  event(name: string, severity: Severity): SecurityEvent;
}
```

| Field            | Summary                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `log`            | The server's logger.                                                                                    |
| `signal`         | Aborted when shutdown or startup rollback begins.                                                       |
| `onClose`        | Registers a disposer, run after the transport drains and before the log closes, under `closeTimeoutMs`. |
| `closeTimeoutMs` | Time each disposer has to settle, in milliseconds: the server's `pluginCloseTimeoutMs`.                 |
| `publicOrigin`   | The server's `publicOrigin`, resolved to a list.                                                        |
| `event`          | Registers a security event and returns its writer; callable only inside `boot`, at most 64 times.       |

Source: `packages/core/src/gate/types.ts:40`

## GateFinding

Why a route is refused at boot: printable characters, cut at 200.

```ts
export interface GateFinding {
  readonly finding: string;
}
```

| Field     | Summary                                            |
| --------- | -------------------------------------------------- |
| `finding` | The reason, written into the boot error's message. |

Source: `packages/core/src/gate/types.ts:71`

## GateInput

The handler's own validated values, as `authorize` receives them.

```ts
export interface GateInput {
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly cookies: unknown;
  readonly body: unknown;
}
```

| Field     | Summary                         |
| --------- | ------------------------------- |
| `params`  | The validated path parameters.  |
| `query`   | The validated query parameters. |
| `headers` | The validated headers.          |
| `cookies` | The validated cookies.          |
| `body`    | The validated body.             |

Source: `packages/core/src/gate/types.ts:111`

## GateRefusal

A refusal by reason; the server writes its status, code, message and headers.

A `challenge` other than `'bearer'` or `null` (a missing one included), or a `retryAfterSeconds` outside 1 to 86,400, is the fixed 500.

```ts
export type GateRefusal =
  | {
      readonly kind: 'refuse';
      readonly reason: 'credential_missing' | 'credential_invalid';
      readonly challenge: 'bearer' | null;
    }
  | {
      readonly kind: 'refuse';
      readonly reason: 'rate_limited';
      readonly retryAfterSeconds: number;
    }
  | {
      readonly kind: 'refuse';
      readonly reason:
        | 'credential_conflict'
        | 'csrf_token'
        | 'access_denied'
        | 'access_hidden'
        | 'resource_missing'
        | 'unavailable';
    };
```

| Field               | Summary                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `kind`              | Marks a refusal.                                                                |
| `reason`            | Why the request is refused; the server maps each reason to its status and code. |
| `challenge`         | Whether the response carries `www-authenticate: Bearer`.                        |
| `retryAfterSeconds` | Whole seconds until a retry can pass, written as `retry-after`.                 |

Source: `packages/core/src/gate/types.ts:154`

## GateRequest

One request as the gate sees it; the same object in both steps, never given to application code.

```ts
export interface GateRequest {
  readonly route: RouteInfo;
  readonly method: string;
  readonly headers: RawHeaders;
  readonly rawCookies: RawCookies;
  readonly clientAddress: string;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly requestId: string;
}
```

| Field           | Summary                                                      |
| --------------- | ------------------------------------------------------------ |
| `route`         | The matched route.                                           |
| `method`        | The request method as received.                              |
| `headers`       | The raw request headers.                                     |
| `rawCookies`    | The request's cookies as sent.                               |
| `clientAddress` | The client's IP address.                                     |
| `signal`        | Aborted when the connection closes or the request times out. |
| `log`           | The request's logger.                                        |
| `requestId`     | The request's local id.                                      |

Source: `packages/core/src/gate/types.ts:91`

## GateRoute

One route as `Gate.bind` sees it.

```ts
export interface GateRoute {
  readonly info: RouteInfo;
  readonly definition: RouteDefinition;
  readonly access: Access;
  readonly csrf: { readonly strict: boolean; readonly exempt: boolean };
}
```

| Field        | Summary                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `info`       | The route's name, method and path.                                                       |
| `definition` | The route's definition as declared.                                                      |
| `access`     | The route's declared access.                                                             |
| `csrf`       | The route group's cross-site mode and whether the group lists the route in `csrfExempt`. |

Source: `packages/core/src/gate/types.ts:59`

## IdentifyOutcome

What `identify` answers; a `null` principal admits only on an `'optional'` route.

An admit whose `principal` is missing or `undefined` is a fault, answered with the fixed 500.

```ts
export type IdentifyOutcome<P> =
  | {
      readonly kind: 'admit';
      readonly principal: P | null;
    }
  | GateRefusal;
```

| Field       | Summary                                     |
| ----------- | ------------------------------------------- |
| `kind`      | Whether the request is admitted or refused. |
| `principal` | The caller identified, or `null` for none.  |

Source: `packages/core/src/gate/types.ts:128`

## NoAccess

The access types of a server without a gate; with them every public type is the one a server had before gates.

```ts
export interface NoAccess extends AccessTypes {
  readonly principal: never;
  readonly grants: { readonly [policy: string]: never };
  readonly '~none': true;
}
```

| Field       | Summary                      |
| ----------- | ---------------------------- |
| `principal` | No principal exists.         |
| `grants`    | No grant exists.             |
| `~none`     | Marks the absence of a gate. |

Source: `packages/core/src/gate/types.ts:17`

## RouteGate

The per-request steps of one bound route.

```ts
export interface RouteGate<P> {
  readonly cookie: boolean;
  identify(request: GateRequest): IdentifyOutcome<P> | Promise<IdentifyOutcome<P>>;
  readonly authorize:
    | ((principal: P, input: GateInput, request: GateRequest) => AuthorizeOutcome | Promise<AuthorizeOutcome>)
    | null;
  readonly release: ((grant: unknown) => void) | null;
}
```

| Field       | Summary                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `cookie`    | Whether `identify` can admit on a cookie alone; such a route needs a strict cross-site group.                   |
| `identify`  | Finds the request's principal after the cross-site check and before any `onRequest` hook.                       |
| `authorize` | Decides a policy route after validation and before any `preHandler` hook; `null` only on an `'optional'` route. |
| `release`   | Releases a grant once, when its request stops running; `null` when the route issues none.                       |

Source: `packages/core/src/gate/types.ts:77`

## SecurityEvent

Writes one record of a registered security event, in category `security` at its declared severity.

Given a request's logger the record carries that request's id and route; it never throws.

```ts
export type SecurityEvent = (log: Logger, fields?: LogFields) => void;
```

Source: `packages/core/src/gate/types.ts:184`

## CSRF_TOKEN_HEADER

The request header a session client writes its CSRF token in, and a gate reads it from.

```ts
export const CSRF_TOKEN_HEADER: "x-csrf-token"
```

Source: `packages/core/src/gate/gate.ts:21`

## GateFault

The error `Gate.boot` throws to name the cause of a failed boot.

`listen` rejects with BootError `GATE_FAILED` and the message `gate failed: <component>: <finding>`.

```ts
export class GateFault extends Error {
  override readonly name = 'GateFault';
  readonly component: string;
  readonly finding: string;
  constructor(component: string, finding: string);
}
```

```ts
new GateFault('store', 'not installed');
```

Source: `packages/core/src/gate/gate.ts:28`
