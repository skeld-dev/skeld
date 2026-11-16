// Does:  Builds the trusted subject calls: reading, disabling and enabling a subject's fence and ending its sessions.
// Holds: Each call is one store unit; a record is written only after a confirmed commit, never for a refused enable.

import { AuthError } from '../auth-error/auth-error.ts';
import type { Centre } from '../server/centre.ts';
import { storeUnavailable } from '../store/unavailable.ts';
import type { EnableRefused, SubjectChanged, Subjects } from './types.ts';
import { checkUserId } from './user-id.ts';

function changed(enabled: boolean, generation: number): SubjectChanged {
  return Object.freeze({ kind: 'done', enabled, generation });
}

function refused(reason: EnableRefused['reason']): EnableRefused {
  return Object.freeze({ kind: 'refused', reason });
}

export function createSubjects(centre: Centre): Subjects {
  return Object.freeze({
    async read(userId: string) {
      const { store, events, log } = centre.use();
      const id = checkUserId(userId);
      try {
        const record = await store.subjectRead({ userId: id });
        return record === null
          ? Object.freeze({ kind: 'absent' as const })
          : Object.freeze({ kind: 'subject' as const, enabled: record.enabled, generation: record.generation });
      } catch (error) {
        return storeUnavailable(events, log, error);
      }
    },

    async disable(userId: string) {
      const { store, events, log } = centre.use();
      const id = checkUserId(userId);
      let done: Awaited<ReturnType<typeof store.subjectDisable>>;
      try {
        done = await store.subjectDisable({ userId: id });
      } catch (error) {
        return storeUnavailable(events, log, error);
      }
      events.subjectChanged(log, { 'auth.user': id, 'auth.change': 'disabled' });
      events.sessionRevoked(log, { 'auth.user': id, 'auth.cause': 'disable' });
      return changed(false, done.generation);
    },

    async enable(userId: string, expectedGeneration: number) {
      const { store, events, log } = centre.use();
      const id = checkUserId(userId);
      if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1) {
        throw new AuthError('INVALID_INPUT');
      }
      let result: Awaited<ReturnType<typeof store.subjectEnable>>;
      try {
        result = await store.subjectEnable({ userId: id, generation: expectedGeneration });
      } catch (error) {
        return storeUnavailable(events, log, error);
      }
      if (result.kind === 'lost') {
        return refused(result.reason);
      }
      events.subjectChanged(log, { 'auth.user': id, 'auth.change': 'enabled' });
      if (result.revoked > 0) {
        events.sessionRevoked(log, { 'auth.user': id, 'auth.cause': 'enable' });
      }
      return changed(true, result.generation);
    },

    async revokeSessions(userId: string) {
      const { store, events, log } = centre.use();
      const id = checkUserId(userId);
      let done: Awaited<ReturnType<typeof store.subjectInvalidate>>;
      try {
        done = await store.subjectInvalidate({ userId: id });
      } catch (error) {
        return storeUnavailable(events, log, error);
      }
      events.sessionRevoked(log, { 'auth.user': id, 'auth.cause': 'revoke_all' });
      return changed(done.enabled, done.generation);
    },
  });
}
