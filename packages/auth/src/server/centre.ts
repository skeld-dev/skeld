// Does:  Holds one auth handle's lifecycle phase and, once booted, the runtime its server-side calls use.
// Holds: The phase only moves forward (new, booting, ready, closed) and the runtime is served only while ready.

import type { Logger } from '@skeld/core/log';
import { AuthError } from '../auth-error/auth-error.ts';
import type { InternalLimits } from '../limit/types.ts';
import type { PolicyBinder } from '../policy/types.ts';
import type { StoreOperations } from '../store/types.ts';
import type { AuthEvents, BearerVerifier } from './internal-types.ts';
import type { SessionConfig } from './options.ts';

// Does:  What a booted handle's calls and gate steps share; shutdown aborts when the server begins to close.
export interface Runtime {
  readonly store: StoreOperations;
  readonly events: AuthEvents;
  readonly log: Logger;
  readonly shutdown: AbortSignal;
  readonly session: SessionConfig;
  readonly limits: InternalLimits;
  readonly binder: PolicyBinder;
  readonly apiKeys: BearerVerifier | null;
  readonly jwt: BearerVerifier | null;
}

export interface Centre {
  claim(): boolean;
  open(runtime: Runtime): void;
  close(): void;
  use(): Runtime;
}

export function createCentre(): Centre {
  let phase: 'new' | 'booting' | 'ready' | 'closed' = 'new';
  let current: Runtime | null = null;
  return Object.freeze({
    // Does:  Takes the one boot a handle has; false when it was already booted, by this server or another.
    claim(): boolean {
      if (phase !== 'new') {
        return false;
      }
      phase = 'booting';
      return true;
    },
    open(runtime: Runtime): void {
      if (phase === 'booting') {
        phase = 'ready';
        current = runtime;
      }
    },
    close(): void {
      phase = 'closed';
      current = null;
    },
    use(): Runtime {
      if (phase === 'closed') {
        throw new AuthError('CLOSED');
      }
      if (current === null) {
        throw new AuthError('NOT_READY');
      }
      return current;
    },
  });
}
