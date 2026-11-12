// Does:  Checks that the packed tarball of the core package carries no diagnostic recorder.
// Holds: The tarball is unpacked in memory under a byte and an entry limit; nothing from it is written or run.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

interface Entry {
  readonly path: string;
  readonly data: Buffer;
}

type Unpacked = { readonly entries: readonly Entry[] } | { readonly refused: string };

const marker = 'skeld:diag-recorder';
// Why: The tarball is untrusted input to this tool, so its unpacked size and entry count are bounded.
const unpackedLimit = 64 * 1024 * 1024;
const entryLimit = 10_000;
const block = 512;
const root = resolve(import.meta.dirname, '..');
const corePath = join(root, 'packages/core');
const usage = 'usage: node tools/check-pack-markers.ts <tarball> | --pack | --help\n';

const nodeShipped: ReadonlySet<string> = new Set(['node', 'import', 'module-sync', 'node-addons', 'default']);
const typesShipped: ReadonlySet<string> = new Set(['types', 'import', 'node', 'default']);
const nodeDiag: ReadonlySet<string> = new Set([...nodeShipped, 'skeld-diag']);
const typesDiag: ReadonlySet<string> = new Set([...typesShipped, 'skeld-diag']);

let problems = 0;

function ok(rule: string, message: string): void {
  process.stdout.write(`ok ${rule} ${message}\n`);
}

function fail(rule: string, message: string): void {
  problems++;
  process.stderr.write(`fail ${rule} ${message}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveTarget(value: unknown, conditions: ReadonlySet<string>): string | null | undefined {
  if (typeof value === 'string' || value === null) {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const [key, branch] of Object.entries(value)) {
    if (key === 'default' || conditions.has(key)) {
      const target = resolveTarget(branch, conditions);
      if (target !== undefined) {
        return target;
      }
    }
  }
  return undefined;
}

function packagePath(entry: unknown, conditions: ReadonlySet<string>): string | undefined {
  const target = resolveTarget(entry, conditions);
  if (typeof target !== 'string' || !target.startsWith('./')) {
    return undefined;
  }
  const path = target.slice(2);
  return posix.normalize(path) === path && !path.startsWith('../') ? path : undefined;
}

function hasDiagBranch(value: unknown): boolean {
  return (
    isRecord(value) && Object.entries(value).some(([key, branch]) => key === 'skeld-diag' || hasDiagBranch(branch))
  );
}

function diagEntry(manifest: unknown): unknown {
  return isRecord(manifest) && isRecord(manifest.imports) ? manifest.imports['#diag'] : undefined;
}

function parseManifest(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function selfTest(): boolean {
  const manifestPath = join(corePath, 'package.json');
  const entry = diagEntry(parseManifest(readFileSync(manifestPath, 'utf8')));
  if (!hasDiagBranch(entry)) {
    fail('S', `${manifestPath} has no imports["#diag"] skeld-diag branch`);
    return false;
  }
  const target = packagePath(entry, nodeDiag);
  if (target === undefined) {
    fail('S', `imports["#diag"] selects no file under the Node diag conditions`);
    return false;
  }
  const file = join(corePath, target);
  if (!existsSync(file)) {
    fail('S', `${file} does not exist; build first with npx tsc -b packages/core`);
    return false;
  }
  if (!readFileSync(file).includes(marker)) {
    fail('S', `${file} does not contain the marker ${marker}`);
    return false;
  }
  ok('S', `packages/core/${target} carries the marker`);
  return true;
}

async function gunzip(path: string): Promise<Buffer | string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    await pipeline(createReadStream(path), createGunzip(), async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > unpackedLimit) {
          throw new Error(`unpacks past ${unpackedLimit} bytes`);
        }
        chunks.push(chunk);
      }
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return Buffer.concat(chunks, size);
}

function field(header: Buffer, start: number, length: number): string {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? length : end).toString('utf8');
}

function octal(header: Buffer, start: number, length: number): number | undefined {
  const text = field(header, start, length).trim();
  return /^[0-7]{1,11}$/.test(text) ? Number.parseInt(text, 8) : undefined;
}

function isZeroBlock(bytes: Buffer): boolean {
  return bytes.every((byte) => byte === 0);
}

function readTar(bytes: Buffer): Unpacked {
  const entries: Entry[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const left = bytes.length - offset;
    const header = bytes.subarray(offset, offset + Math.min(block, left));
    if (isZeroBlock(header)) {
      offset += block;
      continue;
    }
    if (left < block) {
      return { refused: `truncated header at byte ${offset}` };
    }
    if (entries.length === entryLimit) {
      return { refused: `more than ${entryLimit} entries` };
    }
    const size = octal(header, 124, 12);
    const name = field(header, 0, 100);
    const prefix = field(header, 257, 5) === 'ustar' ? field(header, 345, 155) : '';
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const type = header[156];
    offset += block;
    if (size === undefined) {
      return { refused: `entry ${JSON.stringify(path)} has an unreadable size field` };
    }
    if (size > bytes.length - offset) {
      return { refused: `entry ${JSON.stringify(path)} claims ${size} bytes with ${bytes.length - offset} left` };
    }
    if (type !== 0x30 && type !== 0) {
      return {
        refused: `entry ${JSON.stringify(path)} is not a regular file (type ${JSON.stringify(String.fromCharCode(type ?? 0))})`,
      };
    }
    if (!path.startsWith('package/') || posix.normalize(path) !== path) {
      return { refused: `entry ${JSON.stringify(path)} is outside package/` };
    }
    entries.push({ path, data: bytes.subarray(offset, offset + size) });
    offset += Math.ceil(size / block) * block;
  }
  return { entries };
}

async function check(tarball: string, label: string): Promise<number> {
  const unpacked = await gunzip(tarball);
  const read = typeof unpacked === 'string' ? { refused: unpacked } : readTar(unpacked);
  if ('refused' in read) {
    fail('read', `${label} refused: ${read.refused}`);
    return 3;
  }
  const files = new Map(read.entries.map(({ path, data }) => [path, data]));
  const packed = files.get('package/package.json');
  const manifest = packed === undefined ? undefined : parseManifest(packed.toString('utf8'));
  const entry = diagEntry(manifest);
  const version = isRecord(manifest) && typeof manifest.version === 'string' ? manifest.version : '(no version)';
  if (entry === undefined) {
    fail('P1', 'package/package.json does not map #diag; P2 to P6 skipped');
  } else {
    ok('P1', 'package/package.json maps #diag');
    rules(entry, files, read.entries);
  }
  if (problems === 0) {
    process.stdout.write(`Pack check passed: @skeld/core ${version} carries no recorder.\n`);
    return 0;
  }
  process.stderr.write(`Pack check failed: ${problems} problems in ${label}. Do not publish it.\n`);
  return 1;
}

interface Targets {
  readonly shipped: string | undefined;
  readonly allowed: ReadonlySet<string>;
  readonly forbidden: ReadonlySet<string>;
}

function targets(diag: unknown): Targets {
  const shipped = packagePath(diag, nodeShipped);
  const allowed = new Set<string>();
  for (const target of [shipped, packagePath(diag, typesShipped), shipped?.replace(/\.js$/, '.d.ts')]) {
    if (target !== undefined) {
      allowed.add(target);
    }
  }
  const forbidden = new Set<string>();
  for (const target of [packagePath(diag, nodeDiag), packagePath(diag, typesDiag)]) {
    if (target !== undefined && !allowed.has(target)) {
      forbidden.add(target);
    }
  }
  return { shipped, allowed, forbidden };
}

function inPackage(path: string): string {
  return path.slice('package/'.length);
}

function listed(paths: Iterable<string>): string {
  return [...paths].join(', ') || 'none resolved';
}

function report(rule: string, failures: readonly string[], passed: string): void {
  if (failures.length === 0) {
    ok(rule, passed);
  }
  for (const failure of failures) {
    fail(rule, failure);
  }
}

function rules(diag: unknown, files: ReadonlyMap<string, Buffer>, entries: readonly Entry[]): void {
  const { shipped, allowed, forbidden } = targets(diag);
  report(
    'P2',
    shipped !== undefined && files.has(`package/${shipped}`)
      ? []
      : [`the Node shipped target ${shipped ?? '(unresolved)'} is not in the tarball`],
    `${shipped} is in the tarball`,
  );
  report(
    'P3',
    [...forbidden].filter((target) => files.has(`package/${target}`)).map((target) => `${target} is in the tarball`),
    `no recorder target (${listed(forbidden)}) in the tarball`,
  );
  report(
    'P4',
    [...files.keys()]
      .filter((path) => path.startsWith('package/dist/diag/') && !allowed.has(inPackage(path)))
      .map((path) => `${inPackage(path)} is under dist/diag/ and not allowed`),
    `dist/diag/ holds only files of ${listed(allowed)}`,
  );
  report(
    'P5',
    entries.filter(({ data }) => data.includes(marker)).map(({ path }) => `${inPackage(path)} contains ${marker}`),
    `no file contains ${marker}`,
  );
  const references = [...forbidden]
    .filter((target) => target.endsWith('.js'))
    .map((target) => target.replace(/^dist\//, ''));
  report(
    'P6',
    entries
      .filter(({ path }) => path !== 'package/package.json')
      .flatMap(({ path, data }) =>
        references
          .filter((reference) => data.includes(reference))
          .map((reference) => `${inPackage(path)} references ${reference}`),
      ),
    `no file references ${listed(references)}`,
  );
}

async function pack(destination: string, signal: AbortSignal): Promise<string | undefined> {
  const child = spawn('npm', ['pack', '--workspace', '@skeld/core', '--pack-destination', destination], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    signal,
  });
  const errors: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
  let code: unknown;
  try {
    [code] = await once(child, 'close');
  } catch (error) {
    fail('pack', `npm pack did not start: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (code !== 0) {
    process.stderr.write(Buffer.concat(errors));
    fail('pack', `npm pack exited ${String(code)}`);
    return undefined;
  }
  const tarballs = readdirSync(destination).filter((name) => name.endsWith('.tgz'));
  const [tarball] = tarballs;
  if (tarball === undefined || tarballs.length !== 1) {
    fail('pack', `npm pack left ${tarballs.length} tarballs in ${destination}`);
    return undefined;
  }
  return tarball;
}

async function checkPacked(): Promise<number> {
  const destination = mkdtempSync(join(tmpdir(), 'skeld-pack-'));
  const controller = new AbortController();
  const remove = (): void => rmSync(destination, { recursive: true, force: true });
  const interrupt = (): void => {
    controller.abort();
    remove();
    process.exit(3);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const tarball = await pack(destination, controller.signal);
    return tarball === undefined ? 3 : await check(join(destination, tarball), tarball);
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    remove();
  }
}

function main(args: readonly string[]): number | Promise<number> {
  const [arg] = args;
  if (args.length === 1 && arg === '--help') {
    process.stdout.write(usage);
    return 0;
  }
  if (arg === undefined || args.length !== 1 || (arg.startsWith('-') && arg !== '--pack')) {
    process.stderr.write(usage);
    return 2;
  }
  if (!selfTest()) {
    process.stderr.write('Pack check could not run: the self-test failed.\n');
    return 3;
  }
  return arg === '--pack' ? checkPacked() : check(resolve(arg), arg);
}

process.exitCode = await main(process.argv.slice(2));
