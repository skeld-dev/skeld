import { isNode, nodePrototype, type RuntimeNode } from './node.ts';
import { standardOf } from './standard.ts';
import type { StandardProps } from './types.ts';

Object.defineProperty(nodePrototype, '~standard', {
  get(this: unknown): StandardProps<unknown, unknown> | undefined {
    return isNode(this) ? standardOf(this) : undefined;
  },
  enumerable: false,
  configurable: false,
});

export function createNode<F extends RuntimeNode>(fields: F): F {
  const created = { __proto__: nodePrototype, ...fields };
  for (const key of Object.keys(created)) {
    const value: unknown = Reflect.get(created, key);
    if (value === undefined) {
      Reflect.deleteProperty(created, key);
    } else if (key === 'properties' || key === 'members') {
      Object.freeze(value);
    }
  }
  Object.freeze(created);
  return created;
}
