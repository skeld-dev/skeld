export function toPointer(path: readonly (string | number)[]): string {
  let pointer = '';
  for (const segment of path) {
    pointer += `/${`${segment}`.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  }
  return pointer;
}
