import { limit } from '#diag';
import type { PathPart } from './path-decode.ts';
import type { RouteEntry, TreeNode } from './tree.ts';
import type { FindResult } from './types.ts';

type WalkOutcome<T> = RouteEntry<T> | 'param-too-long' | null;

function walk<T>(
  node: TreeNode<T>,
  parts: readonly PathPart[],
  index: number,
  maxParamLength: number,
  values: string[],
): WalkOutcome<T> {
  const part = parts[index];
  if (part === undefined) {
    return node.entry;
  }
  const staticChild = node.staticChildren.get(part.text);
  if (staticChild !== undefined) {
    const outcome = walk(staticChild, parts, index + 1, maxParamLength, values);
    if (outcome !== null) {
      return outcome;
    }
  }
  if (node.paramChild !== null && part.text !== '') {
    limit('limit.param_length', part.rawLength, maxParamLength);
    // Node's HTTP parser refuses non-ASCII request-target bytes, so the raw length is the byte count.
    if (part.rawLength > maxParamLength) {
      return 'param-too-long';
    }
    values.push(part.text);
    const outcome = walk(node.paramChild, parts, index + 1, maxParamLength, values);
    if (outcome !== null) {
      return outcome;
    }
    values.pop();
  }
  if (node.wildcard !== null) {
    values.push(
      parts
        .slice(index)
        .map((rest) => rest.text)
        .join('/'),
    );
    return node.wildcard;
  }
  return null;
}

function isRootPath(parts: readonly PathPart[]): boolean {
  return parts.length === 1 && parts[0]?.rawLength === 0;
}

export function matchPath<T>(root: TreeNode<T>, parts: readonly PathPart[], maxParamLength: number): FindResult<T> {
  const values: string[] = [];
  const outcome = isRootPath(parts) && root.entry !== null ? root.entry : walk(root, parts, 0, maxParamLength, values);
  if (outcome === null) {
    return { kind: 'not-found' };
  }
  if (outcome === 'param-too-long') {
    return { kind: 'param-too-long' };
  }
  const params: Record<string, string> = Object.create(null);
  for (const [position, name] of outcome.paramNames.entries()) {
    const value = values[position];
    if (value !== undefined) {
      params[name] = value;
    }
  }
  return { kind: 'found', value: outcome.value, params };
}
