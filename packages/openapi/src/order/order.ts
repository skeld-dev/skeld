// Does:  Orders text by UTF-16 code unit, the one ordering every sorted map of the document uses.
// Holds: The order depends only on the strings, never on locale, insertion order or the host.

export function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function sortedKeys(keys: Iterable<string>): string[] {
  return [...keys].sort(compareText);
}
