// Does:  Compiles and runs the @example line of every public symbol, from source.
// Holds: An example that fails to compile, fails to run or runs past 10 s is a finding, never a skip.

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { display, type Entry, namespaceSubpath, type PublicSymbol, type Refusal, root } from './walk.ts';

export type Rule =
  | 'missing-block'
  | 'too-long'
  | 'tag'
  | 'example-missing'
  | 'example-compile'
  | 'example-run'
  | 'example-timeout'
  | 'see-target'
  | 'hover-mismatch';

export const ruleOrder: readonly Rule[] = [
  'missing-block',
  'too-long',
  'tag',
  'example-missing',
  'example-compile',
  'example-run',
  'example-timeout',
  'see-target',
  'hover-mismatch',
];

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: Rule;
  readonly text: string;
}

export interface ExampleRun {
  readonly findings: readonly Finding[];
  readonly ran: number;
}

interface Example {
  readonly symbol: PublicSymbol;
  readonly code: string;
  readonly file: string;
}

interface Run {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: Error | undefined;
  readonly timedOut: boolean;
}

const tsc = join(root, 'node_modules/.bin/tsc');
const examplesDir = join(root, 'examples');
const diagnosticPattern = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
// Why: An example is one line; one that has not exited by now is hung, not slow.
const exampleLimitMs = 10_000;
const timeoutText = 'did not exit within 10 s';

function importLines(packageName: string, entries: readonly Entry[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of entries) {
    const specifier = `'${packageName}${entry.subpath.slice(1)}'`;
    if (entry.subpath === namespaceSubpath) {
      lines.push(`import * as t from ${specifier};`);
      continue;
    }
    const names = entry.values.filter((name) => !seen.has(name));
    for (const name of names) {
      seen.add(name);
    }
    if (names.length > 0) {
      lines.push(`import { ${names.join(', ')} } from ${specifier};`);
    }
  }
  return lines;
}

function runNode(args: readonly string[], abort: AbortSignal, limitMs: number | undefined): Promise<Run> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: abort,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    let error: Error | undefined;
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timer =
      limitMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, limitMs);
    child.on('error', (failed) => {
      error = failed;
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      settle({ status, signal, stdout, stderr, error, timedOut });
    });
  });
}

function runSource(file: string, abort: AbortSignal): Promise<Run> {
  return runNode(['--conditions=skeld-source', file], abort, exampleLimitMs);
}

function errorLine(output: string): string {
  const lines = output.split('\n').map((line) => line.trim());
  return lines.find((line) => /^[A-Za-z]*Error\b/.test(line)) ?? lines.find((line) => line !== '') ?? 'no error output';
}

function failure(result: Run): string | undefined {
  if (result.error !== undefined) {
    return `cannot start node: ${result.error.message}`;
  }
  if (result.signal !== null) {
    return `killed by ${result.signal}`;
  }
  return result.status === 0 ? undefined : `exit ${result.status}: ${errorLine(result.stderr)}`;
}

async function compile(
  examples: readonly Example[],
  scratch: string,
  abort: AbortSignal,
): Promise<Map<string, string> | Refusal> {
  const config = join(scratch, 'tsconfig.json');
  writeFileSync(
    config,
    `${JSON.stringify({ extends: join(root, 'tsconfig.base.json'), files: examples.map((example) => example.file) }, null, 2)}\n`,
  );
  const result = await runNode([tsc, '-p', config, '--noEmit', '--pretty', 'false'], abort, undefined);
  if (result.error !== undefined) {
    return { refused: `tsc did not run: ${result.error.message}` };
  }
  const known = new Set(examples.map((example) => example.file));
  const errors = new Map<string, string>();
  for (const line of result.stdout.split('\n')) {
    const match = diagnosticPattern.exec(line);
    if (match === null) {
      continue;
    }
    const file = resolve(root, match[1] ?? '');
    if (!known.has(file)) {
      return { refused: `the examples' program has an error outside the examples: ${line}` };
    }
    if (!errors.has(file)) {
      errors.set(file, `${match[4]} ${match[5]}`);
    }
  }
  if (result.status !== 0 && errors.size === 0) {
    return { refused: `tsc exited ${result.status}: ${errorLine(`${result.stdout}\n${result.stderr}`)}` };
  }
  return errors;
}

async function seeFinding(symbol: PublicSymbol, see: string, abort: AbortSignal): Promise<Finding | 'ran'> {
  const at = { file: symbol.file, line: symbol.line };
  const target = see.split(/\s+/)[0] ?? '';
  const file = resolve(root, target);
  if (!file.startsWith(examplesDir + sep)) {
    return { ...at, rule: 'see-target', text: `${symbol.name}: @see ${target} is outside examples/` };
  }
  if (!existsSync(file)) {
    return { ...at, rule: 'see-target', text: `${symbol.name}: @see ${target} does not exist` };
  }
  const result = await runSource(file, abort);
  if (result.timedOut) {
    return { ...at, rule: 'example-timeout', text: `${symbol.name}: @see ${display(file)} ${timeoutText}` };
  }
  const failed = failure(result);
  return failed === undefined
    ? 'ran'
    : { ...at, rule: 'see-target', text: `${symbol.name}: @see ${display(file)} failed: ${failed}` };
}

async function runExamples(
  examples: readonly Example[],
  scratch: string,
  abort: AbortSignal,
): Promise<ExampleRun | Refusal> {
  const errors = await compile(examples, scratch, abort);
  if ('refused' in errors) {
    return errors;
  }
  const findings: Finding[] = [];
  let ran = 0;
  for (const { symbol, code, file } of examples) {
    const at = { file: symbol.file, line: symbol.line };
    const error = errors.get(file);
    if (error !== undefined) {
      findings.push({ ...at, rule: 'example-compile', text: `${symbol.name}: \`${code}\`: ${error}` });
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: one example runs at a time so others' load never counts against its 10 s limit.
    const result = await runSource(file, abort);
    ran++;
    const failed = result.timedOut ? timeoutText : failure(result);
    if (failed !== undefined) {
      const rule: Rule = result.timedOut ? 'example-timeout' : 'example-run';
      findings.push({ ...at, rule, text: `${symbol.name}: \`${code}\`: ${failed}` });
    }
  }
  return { findings, ran };
}

export async function checkExamples(
  symbols: readonly PublicSymbol[],
  entries: readonly Entry[],
  packageName: string,
  scratch: string,
  abort: AbortSignal,
): Promise<ExampleRun | Refusal> {
  const imports = importLines(packageName, entries);
  const examples: Example[] = [];
  for (const symbol of symbols) {
    const code = symbol.block?.example;
    if (code !== undefined && code !== '') {
      const file = join(scratch, `example-${examples.length + 1}.ts`);
      writeFileSync(file, `${[...imports, code].join('\n')}\n`);
      examples.push({ symbol, code, file });
    }
  }
  const run = examples.length === 0 ? { findings: [], ran: 0 } : await runExamples(examples, scratch, abort);
  if ('refused' in run) {
    return run;
  }
  const findings = [...run.findings];
  let ran = run.ran;
  for (const symbol of symbols) {
    const see = symbol.block?.see;
    if (see !== undefined) {
      // biome-ignore lint/performance/noAwaitInLoops: one example runs at a time so others' load never counts against its 10 s limit.
      const result = await seeFinding(symbol, see, abort);
      if (result === 'ran') {
        ran++;
      } else {
        findings.push(result);
      }
    }
  }
  return { findings, ran };
}
