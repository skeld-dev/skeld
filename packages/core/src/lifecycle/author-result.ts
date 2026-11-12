// Does:  Contains author callbacks and assimilates their results across JavaScript realms.
// Holds: A callback settles once; inspection, subscription and continuation failures stay inside the boundary.

import { describeThrown, writeStderrLine } from './stderr.ts';

export function authorResult<T>(
  call: () => T | Promise<T>,
  done: (value: T, asynchronous: boolean) => void,
  fault: (error: unknown, asynchronous: boolean) => void,
  waiting: () => void,
): void {
  let asynchronous = false;
  const reject = (error: unknown): void => {
    try {
      fault(error, asynchronous);
    } catch (failure) {
      writeStderrLine('CALLBACK', '', 500, 'internal', describeThrown(failure));
    }
  };
  const accept = (value: T): void => {
    try {
      done(value, asynchronous);
    } catch (error) {
      reject(error);
    }
  };
  try {
    const result = call();
    let then: unknown;
    const isAsync = (value: T | Promise<T>): value is Promise<T> => {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        return false;
      }
      then = Reflect.get(value, 'then');
      return typeof then === 'function';
    };
    if (!isAsync(result)) {
      accept(result);
      return;
    }
    waiting();
    asynchronous = true;
    // Why: Read then once and retain its receiver; native settlement ignores repeated resolve or reject calls.
    const pending = new Promise<T>((resolve, rejectPromise) => {
      if (typeof then === 'function') {
        Reflect.apply(then, result, [resolve, rejectPromise]);
      }
    });
    pending.then(accept, reject);
  } catch (error) {
    reject(error);
  }
}
