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
