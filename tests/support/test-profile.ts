// Does:  Selects store coverage for test scripts, never from service availability.
// Holds: Adapter tests keep both stores by default; application behavior scripts run on one store.

export type StoreKind = 'sqlite' | 'postgres';
const selection = process.env.SKELD_TEST_STORES ?? 'both';
if (selection !== 'sqlite' && selection !== 'postgres' && selection !== 'both') {
  throw new Error('SKELD_TEST_STORES must be sqlite, postgres or both');
}
export const storeKinds: readonly StoreKind[] = selection === 'both' ? ['sqlite', 'postgres'] : [selection];
export const behaviorKinds: readonly StoreKind[] = [storeKinds[0] ?? 'sqlite'];
