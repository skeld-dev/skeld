// Does:  Runs a root's start and close: the start-once rule, the rollback of a failed boot, and the shutdown.
// Holds: A root starts at most once, a closed root never starts, and every close call returns the same promise.

import { closed as closeDiagnostics, event, open } from '#diag';
import type { ServerLog } from '../log/shapes.ts';
import { BootError } from './boot-error.ts';
import { dispose } from './disposal.ts';
import type { ScopeState } from './scope.ts';
import type { ResolvedServerOptions } from './types.ts';

export interface RootRunParts {
  readonly root: ScopeState;
  readonly log: ServerLog;
  readonly options: ResolvedServerOptions;
  readonly drain: (() => Promise<void>) | null;
}

export interface RootRun {
  start<R>(prepare: () => () => Promise<R>, ready: (result: R) => void): Promise<R>;
  close(): Promise<void>;
  closing(): boolean;
}

export function createRootRun(parts: RootRunParts): RootRun {
  const { root, log, options, drain } = parts;
  let startCalled = false;
  let closing = false;
  let closed: Promise<void> | null = null;
  let startup: Promise<unknown> | null = null;

  async function start<R>(prepare: () => () => Promise<R>, ready: (result: R) => void): Promise<R> {
    if (closing) {
      throw new BootError('SERVER_CLOSED', `${root.entry}() was called after close()`, null, null);
    }
    if (startCalled) {
      const code = root.entry === 'listen' ? 'ALREADY_LISTENING' : 'ALREADY_STARTED';
      throw new BootError(code, `${root.entry}() was already called`, null, null);
    }
    const boot = prepare();
    startCalled = true;
    root.sealed = true;
    // Why: The diagnostic run opens inside the startup promise, so a refused open rolls back as a failed boot does.
    const running = Promise.try(() => {
      open(options);
      event('state.starting');
      return boot();
    });
    startup = running;
    try {
      const result = await running;
      event('state.ready');
      ready(result);
      return result;
    } catch (cause) {
      try {
        await close();
      } catch (cleanup) {
        if (cause instanceof BootError) {
          throw new BootError(cause.code, cause.message, cause.route, cause.plugin, {
            cause: new AggregateError([cause, cleanup], 'Startup and rollback failed'),
          });
        }
        throw new AggregateError([cause, cleanup], 'Startup and rollback failed', { cause });
      }
      throw cause;
    }
  }

  async function shutdown(): Promise<void> {
    // Why: Startup failures belong to start; shutdown must still release everything acquired before the failure.
    await startup?.then(
      () => undefined,
      () => undefined,
    );
    const failures: unknown[] = [];
    try {
      await drain?.();
    } catch (error) {
      failures.push(error);
    }
    failures.push(...(await dispose(root.disposal, options.pluginCloseTimeoutMs)));
    // Why: Last before diag, so the closed record counts every record the transport and disposers made.
    await log.close();
    event('state.closed');
    closeDiagnostics();
    if (failures.length !== 0) {
      throw new AggregateError(failures, 'Server shutdown failed');
    }
  }

  function close(): Promise<void> {
    if (closed === null) {
      closing = true;
      root.sealed = true;
      event('state.closing');
      // Why: Assign the shared promise before abort dispatch can reenter close through an author's listener.
      closed = Promise.resolve().then(shutdown);
      root.disposal.abort.abort();
    }
    return closed;
  }

  function isClosing(): boolean {
    return closing;
  }

  return { start, close, closing: isClosing };
}
