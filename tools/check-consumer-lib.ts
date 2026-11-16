// Does:  Compiles the packed core and auth declarations and the ts blocks of the checked pages under es2025 alone.
// Holds: Exit 0 only when every subpath with types and every ts block of each page compiles in a fresh consumer folder.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

interface Block {
  readonly page: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

interface Run {
  readonly code: unknown;
  readonly stdout: string;
  readonly stderr: string;
}

const root = resolve(import.meta.dirname, '..');
const tsc = join(root, 'node_modules/.bin/tsc');
const typeRoot = join(root, 'node_modules/@types');
const packages = [
  { name: '@skeld/core', folder: 'core', built: join(root, 'packages/core/dist/log/log.d.ts') },
  { name: '@skeld/auth', folder: 'auth', built: join(root, 'packages/auth/dist/server/auth.d.ts') },
] as const;
const defaultPages = ['docs/logging/logging.md', 'docs/guides/auth.md', 'docs/guides/auth-obligations.md'];
const usage = 'usage: node tools/check-consumer-lib.ts [--page <markdown file>] | --help\n';
const diagnosticPattern = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const typesConditions: ReadonlySet<string> = new Set(['types', 'import', 'node', 'default']);

class CouldNotRun extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveTypes(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const [key, branch] of Object.entries(value)) {
    if (typesConditions.has(key)) {
      const target = resolveTypes(branch);
      if (target !== undefined) {
        return target;
      }
    }
  }
  return undefined;
}

function run(command: string, args: readonly string[], cwd: string): Promise<Run> {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
  return once(child, 'close').then(
    ([code]) => ({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }),
    (error: unknown) => {
      throw new CouldNotRun(`${command} did not start: ${error instanceof Error ? error.message : String(error)}`);
    },
  );
}

function tsBlocks(page: string, shown: string, first: number): Block[] {
  const lines = readFileSync(page, 'utf8').split('\n');
  const blocks: Block[] = [];
  let open: { line: number; lines: string[] } | null = null;
  for (const [index, line] of lines.entries()) {
    if (open === null) {
      if (line === '```ts') {
        open = { line: index + 2, lines: [] };
      }
    } else if (line === '```') {
      const file = `block-${first + blocks.length + 1}.ts`;
      blocks.push({ page: shown, file, line: open.line, text: `${open.lines.join('\n')}\n` });
      open = null;
    } else {
      open.lines.push(line);
    }
  }
  if (open !== null) {
    throw new CouldNotRun(`${page}: a ts block opened at line ${open.line - 1} is never closed`);
  }
  return blocks;
}

async function installPacked(project: string, name: string, folder: string): Promise<void> {
  const destination = join(project, '.packed', folder);
  mkdirSync(destination, { recursive: true });
  const packed = await run('pnpm', ['--filter', name, 'pack', '--pack-destination', destination], root);
  if (packed.code !== 0) {
    throw new CouldNotRun(`pnpm pack of ${name} exited ${String(packed.code)}: ${packed.stderr.trim()}`);
  }
  const tarballs = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
  const [tarball] = tarballs;
  if (tarball === undefined || tarballs.length !== 1) {
    throw new CouldNotRun(`pnpm pack of ${name} left ${tarballs.length} tarballs`);
  }
  const unpacked = await run('tar', ['-xzf', join(destination, tarball), '-C', destination], project);
  if (unpacked.code !== 0) {
    throw new CouldNotRun(`tar exited ${String(unpacked.code)}: ${unpacked.stderr.trim()}`);
  }
  const scope = join(project, 'node_modules/@skeld');
  mkdirSync(scope, { recursive: true });
  renameSync(join(destination, 'package'), join(scope, folder));
}

function subpathImports(project: string, name: string, folder: string, first: number): string[] {
  const manifest: unknown = JSON.parse(
    readFileSync(join(project, 'node_modules/@skeld', folder, 'package.json'), 'utf8'),
  );
  if (!isRecord(manifest) || !isRecord(manifest.exports)) {
    throw new CouldNotRun(`the packed package.json of ${name} has no exports map`);
  }
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(manifest.exports)) {
    if (key === './package.json') {
      continue;
    }
    const target = resolveTypes(entry);
    if (target === undefined || !target.endsWith('.d.ts')) {
      process.stdout.write(`skip ${name}${key.slice(1)}: no declarations for a consumer\n`);
      continue;
    }
    lines.push(`export type * as s${first + lines.length} from '${name}${key.slice(1)}';`);
  }
  if (lines.length === 0) {
    throw new CouldNotRun(`the packed exports map of ${name} names no declarations`);
  }
  return lines;
}

function writeProject(project: string, blocks: readonly Block[]): void {
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ type: 'module', private: true })}\n`);
  const lines: string[] = [];
  for (const { name, folder } of packages) {
    lines.push(...subpathImports(project, name, folder, lines.length));
  }
  writeFileSync(join(project, 'subpaths.ts'), `${lines.join('\n')}\n`);
  for (const block of blocks) {
    writeFileSync(join(project, block.file), block.text);
  }
  const compilerOptions = {
    target: 'es2025',
    module: 'nodenext',
    lib: ['es2025'],
    types: ['node'],
    typeRoots: [typeRoot],
    strict: true,
    skipLibCheck: false,
    noEmit: true,
  };
  const files = ['subpaths.ts', ...blocks.map((block) => block.file)];
  writeFileSync(join(project, 'tsconfig.json'), `${JSON.stringify({ compilerOptions, files }, null, 2)}\n`);
}

function findings(output: string, blocks: readonly Block[]): string[] {
  const byFile = new Map(blocks.map((block) => [block.file, block]));
  const found: string[] = [];
  for (const line of output.split('\n')) {
    const match = diagnosticPattern.exec(line);
    if (match === null) {
      continue;
    }
    const [, file = '', row = '0', column = '0', code = '', message = ''] = match;
    const block = byFile.get(file);
    const where =
      block === undefined ? `${file}:${row}:${column}` : `${block.page}:${block.line + Number(row) - 1}:${column}`;
    found.push(`${where} ${code} ${message}`);
  }
  return found;
}

async function check(pages: readonly string[]): Promise<number> {
  for (const { built, folder } of packages) {
    if (!existsSync(built)) {
      throw new CouldNotRun(
        `${relative(root, built)} is missing; build first with pnpm exec tsc -b packages/${folder}`,
      );
    }
  }
  const blocks: Block[] = [];
  for (const shown of pages) {
    const page = resolve(root, shown);
    if (!existsSync(page)) {
      throw new CouldNotRun(`${shown} does not exist`);
    }
    const found = tsBlocks(page, shown, blocks.length);
    if (found.length === 0) {
      throw new CouldNotRun(`${shown} has no ts block`);
    }
    blocks.push(...found);
  }
  const project = mkdtempSync(join(tmpdir(), 'skeld-consumer-'));
  try {
    for (const { name, folder } of packages) {
      // biome-ignore lint/performance/noAwaitInLoops: pnpm pack runs once at a time, one tarball per folder.
      await installPacked(project, name, folder);
    }
    writeProject(project, blocks);
    const compiled = await run(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], project);
    const found = findings(compiled.stdout, blocks);
    if (compiled.code !== 0 && found.length === 0) {
      throw new CouldNotRun(`tsc exited ${String(compiled.code)}: ${`${compiled.stdout}${compiled.stderr}`.trim()}`);
    }
    for (const finding of found) {
      process.stderr.write(`fail ${finding}\n`);
    }
    if (found.length > 0) {
      process.stderr.write(`Consumer check failed: ${found.length} errors under lib es2025.\n`);
      return 1;
    }
    process.stdout.write(
      `Consumer check passed: every subpath and ${blocks.length} blocks of ${pages.length} page(s) compile under lib es2025.\n`,
    );
    return 0;
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(usage);
    return 0;
  }
  const page = args.length === 2 && args[0] === '--page' ? args[1] : undefined;
  if (args.length !== 0 && page === undefined) {
    process.stderr.write(usage);
    return 2;
  }
  try {
    return await check(page === undefined ? defaultPages : [page]);
  } catch (error) {
    if (error instanceof CouldNotRun) {
      process.stderr.write(`Consumer check could not run: ${error.message}\n`);
      return 3;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
