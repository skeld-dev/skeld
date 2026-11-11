// Does:  Creates schema nodes: frozen objects that share the one node prototype.
// Holds: A node, its properties and its members are frozen at creation, and only createNode makes one.

import { isNode, nodePrototype, type RuntimeNode } from './node.ts';
import { standardOf } from './standard.ts';
import type { StandardProps } from './types.ts';

// Why: Defined once on the prototype, so every node answers ~standard without carrying it as an own key.
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
    // Why: An absent option leaves no key behind, so a node holds only what was declared.
    if (value === undefined) {
      Reflect.deleteProperty(created, key);
    } else if (key === 'properties' || key === 'members') {
      Object.freeze(value);
    }
  }
  Object.freeze(created);
  return created;
}
