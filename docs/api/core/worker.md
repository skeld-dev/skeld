# @skeld/core/worker

## Plugin

A function that declares routes, hooks and plugins on the child scope it is given; it may be async.

```ts
export type Plugin<A extends AccessTypes = NoAccess> = (scope: Scope<A>) => void | Promise<void>;
```

Source: `packages/core/src/server/types.ts:554`

## RegisterOptions

The options of `Scope.register`.

```ts
export interface RegisterOptions {
  readonly name?: string;
}
```

| Field  | Summary                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ |
| `name` | The plugin's name in boot errors (default the function's name, or `plugin #<n>` for an anonymous one). |

Source: `packages/core/src/server/types.ts:557`

## Scope

A place to declare routes, hooks, an error handler and plugins; the server is the root scope.

Its methods throw BootError `REGISTRATION_CLOSED` once `listen` or a worker's `start` is called, or once its plugin settled.

```ts
export interface Scope<A extends AccessTypes = NoAccess> {
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly closeTimeoutMs: number;
  event(name: string, severity: Severity): SecurityEvent;
  onRoutes(callback: (routes: readonly RouteInfo[]) => void): void;
  onClose(callback: () => void | Promise<void>): void;
  routes<C extends ContractRoutes>(
    contract: C,
    handlers: NoInfer<[A] extends [NoAccess] ? Handlers<C> : GatedHandlers<C, A>>,
    options?: NoInfer<RoutesOptions<C>>,
  ): void;
  addHook(name: 'onRequest', hook: OnRequestHook): void;
  addHook(name: 'preHandler', hook: PreHandlerHook): void;
  addHook(name: 'onSend', hook: OnSendHook): void;
  addHook(name: 'onResponse', hook: OnResponseHook): void;
  addHook(name: 'onError', hook: OnErrorHook): void;
  setErrorHandler(handler: ErrorHandler): void;
  register(plugin: Plugin<A>, options?: RegisterOptions): void;
}
```

| Field             | Summary                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `signal`          | Aborted when shutdown or startup rollback begins; plugins must stop their own asynchronous work.                         |
| `log`             | The server's logger, the same in every scope, plugins included; its records carry no request id.                         |
| `closeTimeoutMs`  | Time each `onClose` callback has to settle, in milliseconds: the server's `pluginCloseTimeoutMs`.                        |
| `event`           | Registers a security event and returns its writer; the scopes share 64 names per server, apart from the gate's.          |
| `onRoutes`        | Registers a callback `listen` (before binding) or a worker's `start` calls once with the routes its hooks reach, frozen. |
| `onClose`         | Registers resource disposal in reverse registration order after transport shutdown, also on failed boot.                 |
| `routes`          | Adds a contract's routes to this scope, with one handler per route.                                                      |
| `addHook`         | Adds a hook to this scope; it runs for this scope's routes and its plugins' routes, after its parents' hooks.            |
| `setErrorHandler` | Sets this scope's error handler.                                                                                         |
| `register`        | Adds a plugin, which `listen` or a worker's `start` runs in order with a child scope of this one.                        |

Source: `packages/core/src/server/types.ts:501`

## WorkerOptions

The options of `createWorker`, each as the server option of the same name; no other key is read.

`createWorker` throws BootError `INVALID_OPTION` for a value `createServer` refuses, with the same message.

```ts
export interface WorkerOptions<A extends AccessTypes = NoAccess> {
  readonly gate?: Gate<A>;
  readonly log?: LogOptions | false;
  readonly publicOrigin?: string | readonly string[];
  readonly pluginTimeoutMs?: number;
  readonly pluginCloseTimeoutMs?: number;
}
```

| Field                  | Summary                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `gate`                 | The access control whose boot runs at `start`, after the plugins (default none).                                  |
| `log`                  | The structured log on stdout or a sink; `false` writes no record and calls no sink (default: stdout, no options). |
| `publicOrigin`         | The origins the service is reached at, given to the gate's boot; a malformed one is BootError `INVALID_OPTION`.   |
| `pluginTimeoutMs`      | Time each plugin, and the gate's boot, has to settle at `start`, in ms, at most 2 147 483 647 (default 10 000).   |
| `pluginCloseTimeoutMs` | Time each registered disposer has to settle, in ms, at most 2 147 483 647 (default 10 000).                       |

Source: `packages/core/src/worker/worker.ts:24`

## Worker

A root scope that runs plugins and a gate with no listener: no route, hook, error handler or `listen`.

Its `register`, `onClose` and `event` throw BootError `REGISTRATION_CLOSED` once `start` or `close` is called.

```ts
export interface Worker<A extends AccessTypes = NoAccess> {
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly closeTimeoutMs: number;
  event(name: string, severity: Severity): SecurityEvent;
  onClose(callback: () => void | Promise<void>): void;
  register(plugin: Plugin<A>, options?: RegisterOptions): void;
  start(): Promise<void>;
  close(): Promise<void>;
  logStats(): LogStats;
}
```

| Field            | Summary                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `signal`         | Aborted when shutdown or startup rollback begins; plugins must stop their own asynchronous work.                  |
| `log`            | The worker's logger, the same in every scope, plugins included.                                                   |
| `closeTimeoutMs` | Time each `onClose` callback has to settle, in milliseconds: the worker's `pluginCloseTimeoutMs`.                 |
| `event`          | Registers a security event and returns its writer; the scopes share 64 names per worker, apart from the gate's.   |
| `onClose`        | Registers resource disposal, run in reverse registration order by `close`, also after a failed `start`.           |
| `register`       | Adds a plugin, which `start` runs in order with a child scope of the worker.                                      |
| `start`          | Runs the plugins, refuses any route they registered, boots the gate and calls the `onRoutes` callbacks with none. |
| `close`          | Aborts `signal`, runs the disposers, then flushes the log; waits for a running `start` to settle first.           |
| `logStats`       | Returns this worker's log counts; never throws, before `start` and after `close` too.                             |

Source: `packages/core/src/worker/worker.ts:44`

## createWorker

Creates a worker: a root scope that runs plugins and a gate with no listener; nothing runs until `start`.

Throws BootError `INVALID_OPTION` for an option out of range or malformed.

```ts
export function createWorker<A extends AccessTypes = NoAccess>(options?: WorkerOptions<A>): Worker<A>;
export function createWorker(options?: WorkerOptions): Worker;
```

```ts
const worker = createWorker();
await worker.start();
await worker.close();
```

Source: `packages/core/src/worker/worker.ts:108`
