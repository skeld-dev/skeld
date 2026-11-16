// Does:  Finds the first own key of an option or input object that its type does not name.
// Holds: Every own key is judged, string or symbol, and a key is written only as String(key), never with its value.

export function firstUnknownKey(value: object, known: ReadonlySet<string>): string | null {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !known.has(key)) {
      return String(key);
    }
  }
  return null;
}
