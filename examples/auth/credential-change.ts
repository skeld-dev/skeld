import { hashPassword, verifyPassword } from '@skeld/auth/password';
import type { Subjects } from '@skeld/auth/server';
import type { Secret } from '@skeld/core/secret';
import { PASSWORD_COST } from './login.ts';
import type { UserLocks } from './user-locks.ts';
import type { Users } from './users.ts';

// What the change needs from auth, from the application's store, and the application's per-user lock.
// The walkthrough passes wrappers that fail or pause at a chosen point, to show what each one leaves behind.
export interface ChangeDeps {
  readonly subjects: Pick<Subjects, 'read' | 'disable' | 'enable' | 'revokeSessions'>;
  readonly users: Pick<Users, 'findById' | 'replaceHash'>;
  readonly locks: UserLocks;
}

export type ChangeOutcome =
  // The new password is stored, every old session has ended and the subject is enabled again.
  | { readonly kind: 'changed' }
  // The current password did not verify, or the new one is outside the helper's bounds; nothing changed.
  | { readonly kind: 'refused' }
  // Hashing is saturated; nothing changed.
  | { readonly kind: 'busy' }
  // auth did not apply the disable; nothing changed and old sessions still work.
  | { readonly kind: 'not_started' }
  // The stored hash was replaced after this change verified it (a sign-in's rehash); this one wrote nothing.
  | { readonly kind: 'conflict' }
  // Interrupted after the subject was (or may have been) disabled: sign-in stays closed until reconcile().
  | { readonly kind: 'pending'; readonly step: 'disable' | 'write' | 'enable' }
  // auth refused the enable: someone wrote the fence since this change disabled it. The attempt stops here.
  | { readonly kind: 'stopped'; readonly reason: 'absent' | 'enabled' | 'stale' };

// A credential lives in the application's store and the sessions in auth's; no transaction spans both.
// The order makes every interruption fail closed: disable in auth, then write, then enable. The whole attempt
// holds the user's lock, so no reconciliation of this user runs in between.
export function changePassword(
  deps: ChangeDeps,
  userId: string,
  currentPassword: Secret<string>,
  newPassword: Secret<string>,
  signal: AbortSignal,
): Promise<ChangeOutcome> {
  return deps.locks.run(userId, async (): Promise<ChangeOutcome> => {
    const record = deps.users.findById(userId);
    if (record === undefined) {
      return { kind: 'refused' };
    }
    const checked = await verifyPassword(currentPassword, record.passwordHash, { signal });
    if (checked.kind === 'busy') {
      return { kind: 'busy' };
    }
    if (checked.kind !== 'match') {
      return { kind: 'refused' };
    }
    const next = await hashPassword(newPassword, { cost: PASSWORD_COST, signal });
    if (next.kind === 'busy') {
      return { kind: 'busy' };
    }
    if (next.kind === 'invalid_password') {
      return { kind: 'refused' };
    }

    // Step 1: disable. On 'done' every session has ended; keep the generation it answered for step 3.
    const disabled = await deps.subjects.disable(userId);
    if (disabled.kind === 'unavailable') {
      return disabled.outcome === 'not_applied' ? { kind: 'not_started' } : { kind: 'pending', step: 'disable' };
    }
    const generation = disabled.generation;

    // Step 2: write the new hash, only if the stored hash is still the one verified above.
    let written: boolean;
    try {
      written = deps.users.replaceHash(userId, record.passwordHash, next.hash);
    } catch {
      // The write's outcome is unknown. The subject stays disabled until reconcile() settles it.
      return { kind: 'pending', step: 'write' };
    }

    // Step 3: enable at exactly the generation step 1 answered. auth raises the generation and ends every
    // session in the same unit, so nothing admitted on the old password survives.
    const enabled = await enableOnce(deps, userId, generation);
    if (enabled !== 'done') {
      return enabled;
    }
    return written ? { kind: 'changed' } : { kind: 'conflict' };
  });
}

async function enableOnce(
  deps: ChangeDeps,
  userId: string,
  generation: number,
): Promise<'done' | Extract<ChangeOutcome, { kind: 'pending' | 'stopped' }>> {
  const enabled = await deps.subjects.enable(userId, generation);
  if (enabled.kind === 'done') {
    return 'done';
  }
  if (enabled.kind === 'refused') {
    // The fence was written by someone else since step 1. Stop: no second disable and enable.
    return { kind: 'stopped', reason: enabled.reason };
  }
  if (enabled.outcome === 'not_applied') {
    // Nothing changed; reconcile() repeats the same enable.
    return { kind: 'pending', step: 'enable' };
  }
  // Unknown outcome: read before anything else. Enabled at generation + 1 is this enable's own work.
  const subject = await deps.subjects.read(userId);
  if (subject.kind === 'subject' && subject.enabled && subject.generation === generation + 1) {
    return 'done';
  }
  return { kind: 'pending', step: 'enable' };
}

// Closes an interrupted or stopped change. It takes the user's lock, so no change of this user is running and
// no credential write of this process is outstanding: the record holds whatever the last write committed.
// Disabled at r: enable at r, which ends every session. Enabled: a sign-in may have been admitted on a password
// that is no longer stored, so end every session.
export function reconcile(deps: ChangeDeps, userId: string): Promise<'enabled' | 'revoked' | 'absent' | 'unavailable'> {
  return deps.locks.run(userId, async () => {
    const subject = await deps.subjects.read(userId);
    if (subject.kind === 'unavailable') {
      return 'unavailable';
    }
    if (subject.kind === 'absent') {
      return 'absent';
    }
    if (subject.enabled) {
      const revoked = await deps.subjects.revokeSessions(userId);
      return revoked.kind === 'done' ? 'revoked' : 'unavailable';
    }
    const enabled = await deps.subjects.enable(userId, subject.generation);
    // A refusal here means the fence moved after the read: under the lock that is another process's work.
    return enabled.kind === 'done' ? 'enabled' : 'unavailable';
  });
}
