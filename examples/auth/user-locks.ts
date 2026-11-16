// The application's own per-user serialization for credential changes and reconciliation. Auth supplies none.
//
// This lock lives in one process's memory: it serializes the work of this process only. A deployment with
// several processes needs one shared serialization per user instead, for example a row lock
// (SELECT ... FOR UPDATE) in the application's database held for the whole change, or a single writer queue.
export interface UserLocks {
  // Runs work once every earlier holder of this user's lock has finished; later callers wait their turn.
  run<T>(userId: string, work: () => Promise<T>): Promise<T>;
}

export function createUserLocks(): UserLocks {
  const tails = new Map<string, Promise<void>>();
  return {
    run: async (userId, work) => {
      const previous = tails.get(userId) ?? Promise.resolve();
      const { promise: released, resolve: release } = Promise.withResolvers<void>();
      const tail = previous.then(() => released);
      tails.set(userId, tail);
      await previous;
      try {
        return await work();
      } finally {
        release();
        if (tails.get(userId) === tail) {
          tails.delete(userId);
        }
      }
    },
  };
}
