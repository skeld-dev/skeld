// Does:  Renders a path of keys and indexes as a JSON Pointer.
// Holds: Inside a segment '~' becomes ~0 and '/' becomes ~1, in that order (RFC 6901).

export function toPointer(path: readonly (string | number)[]): string {
  let pointer = '';
  for (const segment of path) {
    pointer += `/${`${segment}`.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  }
  return pointer;
}
