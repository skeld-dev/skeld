// Does:  Selects store coverage and repetition for test scripts, never from service availability.
// Holds: Adapter tests keep both stores by default; exhaustive restores repeated application matrices.

export type StoreKind = 'sqlite' | 'postgres';
const selection = process.env.SKELD_TEST_STORES ?? 'both';
if (selection !== 'sqlite' && selection !== 'postgres' && selection !== 'both') {
  throw new Error('SKELD_TEST_STORES must be sqlite, postgres or both');
}
export const storeKinds: readonly StoreKind[] = selection === 'both' ? ['sqlite', 'postgres'] : [selection];
export const exhaustive = process.env.SKELD_TEST_PROFILE === 'exhaustive';
export const behaviorKinds: readonly StoreKind[] = exhaustive ? storeKinds : [storeKinds[0] ?? 'sqlite'];
