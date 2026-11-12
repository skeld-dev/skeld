// Does:  Takes an error's frames by the extraction policy: getter identity, a descriptor walk, one read, the header.
// Holds: A failed step gives no frames, and no step runs while a stack read of this process is in progress.

import { sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isProxy } from 'node:util/types';
import { CHAIN_MAX, FRAME_UNITS, FRAMES_MAX } from './limits.ts';

// Why: V8 gives every error of this realm one own stack getter; a value holding any other accessor is left uncalled.
const STACK_GETTER = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;

const FRAME_PREFIX = '    at ';

// Why: A formatter that logs an error re-enters the reader; its errors get no frames, so extraction cannot recurse.
let busy = false;

// Does:  Reads an own property: its string, undefined when there is none, null when it is anything else.
function ownString(target: object, key: string): string | null | undefined {
  const found = Object.getOwnPropertyDescriptor(target, key);
  if (found === undefined) {
    return undefined;
  }
  return typeof found.value === 'string' ? found.value : null;
}

// Does:  Builds V8's header from the first own name and message, or null unless both are string data properties.
// Holds: Every object is tested with isProxy before a descriptor of it is read, and no accessor is called.
function headerOf(value: object): string | null {
  let name: string | null | undefined;
  let message: string | null | undefined;
  let current: object | null = value;
  for (let seen = 0; current !== null; seen++) {
    if (seen === CHAIN_MAX || isProxy(current)) {
      return null;
    }
    name ??= ownString(current, 'name');
    message ??= ownString(current, 'message');
    if (name === null || message === null) {
      return null;
    }
    current = Object.getPrototypeOf(current);
  }
  if (name === undefined || message === undefined) {
    return null;
  }
  if (message === '') {
    return name;
  }
  return name === '' ? message : `${name}: ${message}`;
}

// Holds: The busy mark is set for exactly the duration of the one getter call, whether it returns or throws.
function readStack(getter: () => unknown, value: object): string | null {
  busy = true;
  try {
    const text: unknown = Reflect.apply(getter, value, []);
    return typeof text === 'string' ? text : null;
  } catch {
    // Why: The formatter is application code; whatever it throws ends the policy with no frames and is never read.
    return null;
  } finally {
    busy = false;
  }
}

function withoutCwd(line: string, cwd: string): string {
  // Why: A root working directory prefixes every path, so removing it would only strip the separators.
  if (cwd === '' || cwd.endsWith(sep)) {
    return line;
  }
  return line.replaceAll(`${pathToFileURL(cwd).href}/`, '').replaceAll(`${cwd}${sep}`, '');
}

function framesOf(text: string, header: string, cwd: string): string | null {
  if (!text.startsWith(`${header}\n`)) {
    return null;
  }
  const frames: string[] = [];
  let start = header.length + 1;
  while (frames.length < FRAMES_MAX) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line.length === FRAME_PREFIX.length || !line.startsWith(FRAME_PREFIX)) {
      break;
    }
    frames.push(withoutCwd(line, cwd).slice(0, FRAME_UNITS));
    if (end === -1) {
      break;
    }
    start = end + 1;
  }
  return frames.length === 0 ? null : frames.join('\n');
}

// Does:  Runs the four steps on a value Error.isError accepted: its frames joined by a newline, or null when one fails.
export function readFrames(value: object, cwd: string): string | null {
  if (busy) {
    return null;
  }
  const getter = STACK_GETTER;
  if (getter === undefined || Object.getOwnPropertyDescriptor(value, 'stack')?.get !== getter) {
    return null;
  }
  const header = headerOf(value);
  if (header === null) {
    return null;
  }
  const text = readStack(getter, value);
  return text === null ? null : framesOf(text, header, cwd);
}
