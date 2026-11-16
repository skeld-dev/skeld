// Does:  Exports @skeld/auth/server: the auth centre's handle, its options and the access types its gate gives.
// Holds: This file's exports are the subpath's whole public surface.

import type { LimitKey, LimitVerdict } from '../limit/types.ts';
import { createSessions } from '../session/sessions.ts';
import { createSubjects } from '../session/subjects.ts';
import { createCentre } from './centre.ts';
import { createGate } from './gate.ts';
import { createSessionHandlers } from './handlers.ts';
import type { AnyPolicy } from '../policy/types.ts';
import type { Auth, AuthOptions, CreateAuth } from './types.ts';

export type { LimitKey, LimitRule, Limits, LimitVerdict } from '../limit/types.ts';
export type { Grant } from '../policy/types.ts';
export type {
  EnableRefused,
  EstablishInput,
  Established,
  LiveSession,
  Rotated,
  Sessions,
  SessionState,
  SubjectChanged,
  Subjects,
} from '../session/types.ts';
export type { Unavailable } from '../store/types.ts';
export type { Auth, AuthAccess, AuthAccessOf, AuthOptions, CreateAuth, SessionOptions } from './types.ts';

/**
 * Creates one server's auth: its gate, session handlers and trusted calls; it reads and checks nothing until `listen`.
 * The server's `listen` rejects BootError `GATE_FAILED` for a bad option; one handle serves one server.
 * @example const auth = createAuth({ store: createSqliteStore({ path: '/var/lib/app/auth.db' }), origin: 'https://app.example' });
 */
export const createAuth: CreateAuth = <const P extends readonly AnyPolicy[], const L extends string>(
  options: AuthOptions<P, L>,
): Auth<P, L> => {
  const centre = createCentre();
  const { sessions, parts } = createSessions(centre);
  const gate: Auth<P, L>['gate'] = createGate(options, centre, parts);
  const handlers: Auth<P, L>['handlers']['session'] = createSessionHandlers(centre);
  return Object.freeze({
    gate,
    handlers: Object.freeze({ session: handlers }),
    sessions,
    subjects: createSubjects(centre),
    limits: Object.freeze({
      charge(scope: string, key: LimitKey, signal?: AbortSignal): Promise<LimitVerdict> {
        return Promise.try(() => centre.use().limits.charge(scope, key, signal));
      },
    }),
  });
};
