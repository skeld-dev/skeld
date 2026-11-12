// Does:  Runs the registered plugins depth-first in registration order, each under a time limit.
// Holds: A scope is sealed once its plugin settles, fails or times out; nothing registers on it afterwards.

import { end, start } from '#diag';
import { BootError } from './boot-error.ts';
import { causeMessage } from './cause-message.ts';
import { type ChildScope, createScope, type ScopeState } from './scope.ts';

async function runPlugin(child: ChildScope, timeoutMs: number): Promise<void> {
  const { name } = child.state;
  const span = start('boot.plugin', name);
  const expiry = Promise.withResolvers<'timed-out'>();
  const timer = setTimeout(() => expiry.resolve('timed-out'), timeoutMs);
  let outcome: 'settled' | 'timed-out';
  try {
    // Why: Promise.try turns a plugin that throws synchronously into a rejection the same catch handles.
    const settled = Promise.try(child.plugin, createScope(child.state)).then(() => 'settled' as const);
    outcome = await Promise.race([settled, expiry.promise]);
  } catch (cause) {
    throw new BootError('PLUGIN_FAILED', `Plugin ${name} failed: ${causeMessage(cause)}`, null, name, { cause });
  } finally {
    clearTimeout(timer);
    child.state.sealed = true;
    end(span);
  }
  if (outcome === 'timed-out') {
    throw new BootError('PLUGIN_TIMEOUT', `Plugin ${name} did not settle within ${timeoutMs} ms`, null, name);
  }
}

async function bootChild(child: ChildScope, timeoutMs: number): Promise<void> {
  await runPlugin(child, timeoutMs);
  await bootPlugins(child.state, timeoutMs);
}

export async function bootPlugins(state: ScopeState, timeoutMs: number): Promise<void> {
  for (const child of state.children) {
    if (state.disposal.abort.signal.aborted) {
      throw new BootError('SERVER_CLOSED', 'Server closed during plugin boot', null, state.name);
    }
    // biome-ignore lint/performance/noAwaitInLoops: boot order is sequential by design
    await bootChild(child, timeoutMs);
  }
}
