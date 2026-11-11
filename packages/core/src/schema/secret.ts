// Does:  Defines Secret, the wrapper that keeps a secret value out of logs, JSON and string conversion.
// Holds: The value is a private field read only through expose(); every conversion yields '[secret]'.

let read: <T>(secret: Secret<T>) => T;

/**
 * A value marked `secret`: it prints, stringifies and serializes as `[secret]`.
 * It is not assignable to the value it holds; only `expose` returns that value.
 * @example String(new Secret('hunter2'))
 */
export class Secret<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  // Why: The static block hands the private field's reader to expose() without any public accessor.
  static {
    read = (secret) => secret.#value;
  }

  toString(): string {
    return '[secret]';
  }

  toJSON(): string {
    return '[secret]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[secret]';
  }
}

/**
 * Returns the value a `Secret` holds.
 * The one way to read a secret, so a search for `expose(` finds every place one leaves.
 * @example expose(new Secret('hunter2'))
 */
export function expose<T>(secret: Secret<T>): T {
  return read(secret);
}
