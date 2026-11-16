// Does:  Holds the conformance kit's assertions and the generators of the values its cases send to a store.
// Holds: A failed assertion throws CaseFailure whose detail names what was observed and what the contract expected.

import { StoreFailure } from '../store/store.ts';
import type { Digest } from '../store/types.ts';

class CaseFailure extends Error {
  override readonly name = 'CaseFailure';
}

export function check(condition: boolean, detail: string): asserts condition {
  if (!condition) {
    throw new CaseFailure(detail);
  }
}

export function same(actual: unknown, expected: unknown, what: string): void {
  check(Object.is(actual, expected), `${what}: expected ${String(expected)}, got ${String(actual)}`);
}

// Does:  Narrows a result to the case of the given kind, or fails naming the kind that came back.
export function kind<R extends { readonly kind: string }, K extends R['kind']>(
  result: R | null,
  expected: K,
  what: string,
): Extract<R, { readonly kind: K }> {
  check(result !== null, `${what}: expected ${expected}, got null`);
  if (isKind(result, expected)) {
    return result;
  }
  const reason = 'reason' in result ? ` (${String(result.reason)})` : '';
  throw new CaseFailure(`${what}: expected ${expected}, got ${result.kind}${reason}`);
}

function isKind<R extends { readonly kind: string }, K extends R['kind']>(
  result: R,
  expected: K,
): result is Extract<R, { readonly kind: K }> {
  return result.kind === expected;
}

export function lostWith(result: { readonly kind: string }, reason: string, what: string): void {
  const got = 'reason' in result ? String(result.reason) : 'none';
  check(result.kind === 'lost' && got === reason, `${what}: expected lost (${reason}), got ${result.kind} (${got})`);
}

export async function rejectsWith(
  promise: Promise<unknown>,
  reason: StoreFailure['reason'],
  applied: StoreFailure['applied'],
  what: string,
): Promise<void> {
  let outcome: unknown;
  try {
    outcome = await promise;
  } catch (error) {
    check(error instanceof StoreFailure, `${what}: rejected with ${describe(error)}, not StoreFailure`);
    same(error.reason, reason, `${what} reason`);
    same(error.applied, applied, `${what} applied`);
    return;
  }
  throw new CaseFailure(`${what}: resolved ${JSON.stringify(outcome)} instead of rejecting StoreFailure ${reason}`);
}

export function describe(error: unknown): string {
  if (error instanceof StoreFailure) {
    return `StoreFailure ${error.reason}, applied ${error.applied}, code ${String(error.code)}`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function newDigest(): Digest {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function newUserId(): string {
  return `user-${hex(8)}`;
}

export function newKeyId(): string {
  return hex(8);
}

function hex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function sameBytes(actual: Uint8Array, expected: Uint8Array): boolean {
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

// Does:  Checks the form a result's Digest must have: a plain 32-byte Uint8Array that owns its buffer.
export function plainDigest(value: unknown, what: string): void {
  check(value instanceof Uint8Array, `${what}: not a Uint8Array`);
  check(Object.getPrototypeOf(value) === Uint8Array.prototype, `${what}: prototype is not Uint8Array.prototype`);
  check(value.byteOffset === 0 && value.buffer.byteLength === 32, `${what}: not a 32-byte buffer of its own`);
}

// Does:  Checks that a result is frozen with every object and array inside it; typed arrays cannot be frozen.
export function deepFrozen(value: unknown, what: string): void {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) {
    return;
  }
  check(Object.isFrozen(value), `${what}: not frozen`);
  for (const [key, inner] of Object.entries(value)) {
    deepFrozen(inner, `${what}.${key}`);
  }
}

export function integer(value: unknown, what: string): void {
  check(Number.isSafeInteger(value), `${what}: ${String(value)} is not an integer of epoch milliseconds`);
}
