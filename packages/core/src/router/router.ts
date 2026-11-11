// Does:  Holds one route tree per HTTP method; adds routes at boot and finds them per request.
// Holds: A method and path pair is added at most once; a duplicate is reported, never overwritten.

import { end, start } from '#diag';
import { matchPath } from './match.ts';
import { splitPath } from './path-decode.ts';
import { createNode, findEntry, insertRoute, type TreeNode } from './tree.ts';
import type { Router } from './types.ts';

interface MethodTable<T> {
  [method: string]: TreeNode<T> | undefined;
}

export function createRouter<T>(): Router<T> {
  // Why: No prototype, so a method string from a request can never find an inherited member.
  const trees: MethodTable<T> = Object.create(null);
  return {
    add(method, _path, segments, value) {
      const span = start('boot.router_add');
      const existingRoot = trees[method];
      const existing = existingRoot === undefined ? null : findEntry(existingRoot, segments);
      if (existing !== null) {
        end(span);
        return { kind: 'duplicate', existing: existing.value };
      }
      const root = existingRoot ?? createNode<T>();
      trees[method] = root;
      insertRoute(root, segments, value);
      end(span);
      return { kind: 'added' };
    },
    find(method, rawPath, maxParamLength) {
      // Why: Only origin-form targets are routed; asterisk-form and authority-form find nothing.
      if (!rawPath.startsWith('/')) {
        return { kind: 'not-found' };
      }
      const split = start('req.route.split');
      const parts = splitPath(rawPath);
      end(split);
      if (parts === null) {
        return { kind: 'malformed-path' };
      }
      const root = trees[method];
      if (root === undefined) {
        return { kind: 'not-found' };
      }
      const match = start('req.route.match');
      const found = matchPath(root, parts, maxParamLength);
      end(match);
      return found;
    },
  };
}
