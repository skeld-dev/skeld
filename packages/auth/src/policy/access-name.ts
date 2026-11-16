// Does:  Tests an access name, the name of a policy, an action or a limit scope.
// Holds: True only for a string of 1 to 64 characters: a letter, then letters, digits, _, . and -.

const ACCESS_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function isAccessName(value: unknown): value is string {
  return typeof value === 'string' && ACCESS_NAME.test(value);
}
