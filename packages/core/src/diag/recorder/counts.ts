export interface Counter {
  readonly label: string;
  total: number;
}

const counters: Counter[] = [];
const keyless = new Map<string, Counter>();
const keyed = new Map<string, Map<string | number, Counter>>();

function register(label: string): Counter {
  const created: Counter = { label, total: 0 };
  counters.push(created);
  return created;
}

export function counter(name: string): Counter {
  const found = keyless.get(name);
  if (found !== undefined) {
    return found;
  }
  const created = register(name);
  keyless.set(name, created);
  return created;
}

export function keyedCounter(name: string, key: string | number): Counter {
  let byKey = keyed.get(name);
  if (byKey === undefined) {
    byKey = new Map();
    keyed.set(name, byKey);
  }
  const found = byKey.get(key);
  if (found !== undefined) {
    return found;
  }
  const created = register(`${name}{${key}}`);
  byKey.set(key, created);
  return created;
}

export function countTotals(): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const { label, total } of counters) {
    totals[label] = total;
  }
  return totals;
}
