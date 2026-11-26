// Does:  Keeps one server's registry of the security events its scopes register, apart from the gate's.
// Holds: At most 64 names, each with one severity and one writer; a name never changes severity once registered.

import { isEventRegistration, MAX_EVENTS } from '../gate/boot.ts';
import type { SecurityEvent } from '../gate/types.ts';
import type { ServerLog } from '../log/shapes.ts';
import type { Severity } from '../log/types.ts';

interface Registered {
  readonly severity: Severity;
  readonly writer: SecurityEvent;
}

export interface ScopeEvents {
  register(name: string, severity: Severity): SecurityEvent;
}

export function createScopeEvents(log: ServerLog): ScopeEvents {
  const names = new Map<string, Registered>();
  return {
    register(name, severity) {
      if (!isEventRegistration(name, severity)) {
        throw new TypeError('Scope.event refused the name or the severity');
      }
      const known = names.get(name);
      if (known !== undefined) {
        if (known.severity !== severity) {
          throw new TypeError(`Scope.event ${name} is already registered with severity ${known.severity}`);
        }
        return known.writer;
      }
      if (names.size >= MAX_EVENTS) {
        throw new TypeError(`Scope.event refused ${name}: a server registers at most ${MAX_EVENTS} names`);
      }
      const writer: SecurityEvent = Object.freeze((logger: unknown, fields?: Parameters<SecurityEvent>[1]) => {
        log.security(name, severity, logger, fields);
      });
      names.set(name, { severity, writer });
      return writer;
    },
  };
}
