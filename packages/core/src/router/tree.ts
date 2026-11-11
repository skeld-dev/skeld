// Does:  Builds and reads the route tree: static children, one parameter child and a wildcard per node.
// Holds: A node has at most one parameter child and one wildcard, and a wildcard ends its route.

import type { PathSegment } from '../contract/types.ts';

export interface RouteEntry<T> {
  readonly value: T;
  readonly paramNames: readonly string[];
}

export interface TreeNode<T> {
  readonly staticChildren: Map<string, TreeNode<T>>;
  paramChild: TreeNode<T> | null;
  wildcard: RouteEntry<T> | null;
  entry: RouteEntry<T> | null;
}

export function createNode<T>(): TreeNode<T> {
  return { staticChildren: new Map(), paramChild: null, wildcard: null, entry: null };
}

export function findEntry<T>(root: TreeNode<T>, segments: readonly PathSegment[]): RouteEntry<T> | null {
  let node = root;
  for (const segment of segments) {
    if (segment.kind === 'wildcard') {
      return node.wildcard;
    }
    const next = segment.kind === 'static' ? (node.staticChildren.get(segment.text) ?? null) : node.paramChild;
    if (next === null) {
      return null;
    }
    node = next;
  }
  return node.entry;
}

function paramNamesOf(segments: readonly PathSegment[]): string[] {
  const names: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'param') {
      names.push(segment.name);
    } else if (segment.kind === 'wildcard') {
      // Why: A wildcard's captured remainder is exposed as the parameter named '*'.
      names.push('*');
    }
  }
  return names;
}

export function insertRoute<T>(root: TreeNode<T>, segments: readonly PathSegment[], value: T): void {
  const entry: RouteEntry<T> = { value, paramNames: paramNamesOf(segments) };
  let node = root;
  for (const segment of segments) {
    if (segment.kind === 'wildcard') {
      node.wildcard = entry;
      return;
    }
    if (segment.kind === 'static') {
      let child = node.staticChildren.get(segment.text);
      if (child === undefined) {
        child = createNode<T>();
        node.staticChildren.set(segment.text, child);
      }
      node = child;
    } else {
      if (node.paramChild === null) {
        node.paramChild = createNode<T>();
      }
      node = node.paramChild;
    }
  }
  node.entry = entry;
}
