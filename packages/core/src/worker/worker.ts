// Does:  Defines createWorker: a root scope that boots plugins and a gate with no listener, and its close.
// Holds: It constructs no node:http server and imports no module that does; nothing it boots is ever bound.

import { bootGate, resolveGate } from '../gate/boot.ts';
import type { AccessTypes, Gate, NoAccess, SecurityEvent } from '../gate/types.ts';
import { resolveLog } from '../log/options.ts';
import { createServerLog } from '../log/server-log.ts';
import type { Logger, LogOptions, LogStats, Severity } from '../log/types.ts';
import { BootError } from '../server/boot-error.ts';
import { bootRootPlugins } from '../server/boot.ts';
import { createScopeEvents } from '../server/events.ts';
import { resolveServerOptions } from '../server/options.ts';
import { createRootRun } from '../server/root-run.ts';
import { callRoutesCallbacks } from '../server/routes-callbacks.ts';
import { createRootState, createScope, pluginName, type ScopeState } from '../server/scope.ts';
import type { Plugin, RegisterOptions, ServerOptions } from '../server/types.ts';

export type { Plugin, RegisterOptions, Scope } from '../server/types.ts';

/**
 * The options of `createWorker`, each as the server option of the same name; no other key is read.
 * `createWorker` throws BootError `INVALID_OPTION` for a value `createServer` refuses, with the same message.
 */
export interface WorkerOptions<A extends AccessTypes = NoAccess> {
  /** The access control whose boot runs at `start`, after the plugins (default none). */
  readonly gate?: Gate<A>;
  /** The structured log on stdout or a sink; `false` writes no record and calls no sink (default: stdout, no options). */
  readonly log?: LogOptions | false;
  /** The origins the service is reached at, given to the gate's boot; a malformed one is BootError `INVALID_OPTION`. */
  readonly publicOrigin?: string | readonly string[];
  /**
   * Time each plugin, and the gate's boot, has to settle at `start`, in ms, at most 2 147 483 647 (default 10 000).
   * Past it `start` rejects with BootError `PLUGIN_TIMEOUT`, or `GATE_FAILED` for the gate.
   */
  readonly pluginTimeoutMs?: number;
  /** Time each registered disposer has to settle, in ms, at most 2 147 483 647 (default 10 000). */
  readonly pluginCloseTimeoutMs?: number;
}

/**
 * A root scope that runs plugins and a gate with no listener: no route, hook, error handler or `listen`.
 * Its `register`, `onClose` and `event` throw BootError `REGISTRATION_CLOSED` once `start` or `close` is called.
 */
export interface Worker<A extends AccessTypes = NoAccess> {
  /** Aborted when shutdown or startup rollback begins; plugins must stop their own asynchronous work. */
  readonly signal: AbortSignal;
  /** The worker's logger, the same in every scope, plugins included. */
  readonly log: Logger;
  /** Time each `onClose` callback has to settle, in milliseconds: the worker's `pluginCloseTimeoutMs`. */
  readonly closeTimeoutMs: number;
  /**
   * Registers a security event and returns its writer; the scopes share 64 names per worker, apart from the gate's.
   * Names follow `GateBoot.event`'s rules; a name repeated with another severity throws `TypeError`.
   */
  event(name: string, severity: Severity): SecurityEvent;
  /**
   * Registers resource disposal, run in reverse registration order by `close`, also after a failed `start`.
   * Each callback runs once under `pluginCloseTimeoutMs`.
   */
  onClose(callback: () => void | Promise<void>): void;
  /**
   * Adds a plugin, which `start` runs in order with a child scope of the worker.
   * A plugin that throws or rejects makes `start` reject with BootError `PLUGIN_FAILED`.
   */
  register(plugin: Plugin<A>, options?: RegisterOptions): void;
  /**
   * Runs the plugins, refuses any route they registered, boots the gate and calls the `onRoutes` callbacks with none.
   * Rejects with BootError: `ALREADY_STARTED`, `SERVER_CLOSED`, `ROUTE_WITHOUT_LISTENER` or the failed step's code.
   */
  start(): Promise<void>;
  /**
   * Aborts `signal`, runs the disposers, then flushes the log; waits for a running `start` to settle first.
   * A disposer that fails rejects AggregateError after every other one ran; every call returns the same promise.
   */
  close(): Promise<void>;
  /** Returns this worker's log counts; never throws, before `start` and after `close` too. */
  logStats(): LogStats;
}

// Does:  The three server options a worker shares, read by name so no other key reaches resolveServerOptions.
function sharedOptions(options: WorkerOptions): ServerOptions {
  const { publicOrigin, pluginTimeoutMs, pluginCloseTimeoutMs } = options;
  return {
    ...(publicOrigin === undefined ? {} : { publicOrigin }),
    ...(pluginTimeoutMs === undefined ? {} : { pluginTimeoutMs }),
    ...(pluginCloseTimeoutMs === undefined ? {} : { pluginCloseTimeoutMs }),
  };
}

// Does:  Refuses the first route in the order onRoutes lists them: a scope's own, then each plugin's, depth-first.
function refuseRoutes(state: ScopeState): void {
  const [record] = state.routes;
  if (record !== undefined) {
    const { info } = record;
    const message = `Route ${info.name} (${info.method} ${info.path}): registered on a worker, which serves no route`;
    throw new BootError('ROUTE_WITHOUT_LISTENER', message, info, pluginName(state));
  }
  for (const child of state.children) {
    refuseRoutes(child.state);
  }
}

/**
 * Creates a worker: a root scope that runs plugins and a gate with no listener; nothing runs until `start`.
 * Throws BootError `INVALID_OPTION` for an option out of range or malformed.
 * @example const worker = createWorker(); await worker.start(); await worker.close();
 */
export function createWorker<A extends AccessTypes = NoAccess>(options?: WorkerOptions<A>): Worker<A>;
// Why: A last overload without a gate keeps ReturnType<typeof createWorker> the gate-less Worker.
export function createWorker(options?: WorkerOptions): Worker;
export function createWorker(options: WorkerOptions = {}): Worker {
  const resolved = resolveServerOptions(sharedOptions(options));
  const gate = resolveGate(options.gate);
  const log = createServerLog(resolveLog(options.log), 'worker');
  const root = createRootState(log.logger(null), createScopeEvents(log), resolved.pluginCloseTimeoutMs, 'start');
  const run = createRootRun({ root, log, options: resolved, drain: null });

  async function boot(): Promise<void> {
    await bootRootPlugins(root, resolved.pluginTimeoutMs);
    // Why: Checked before the gate as well as after it, so a gate never boots on a worker that is closing.
    refuseIfClosing();
    refuseRoutes(root);
    if (gate !== null) {
      await bootGate(gate, root, resolved, log);
    }
    refuseIfClosing();
    callRoutesCallbacks(root);
    // Why: An onRoutes callback can call close; a closing worker must not resolve start or write its started record.
    refuseIfClosing();
  }

  function refuseIfClosing(): void {
    if (run.closing()) {
      throw new BootError('SERVER_CLOSED', 'Server closed during startup', null, null);
    }
  }

  function start(): Promise<void> {
    return run.start(
      () => boot,
      () => log.started(),
    );
  }

  function logStats(): LogStats {
    return log.stats();
  }

  const { signal, log: logger, closeTimeoutMs, event, onClose, register } = createScope(root);
  return { signal, log: logger, closeTimeoutMs, event, onClose, register, start, close: run.close, logStats };
}
