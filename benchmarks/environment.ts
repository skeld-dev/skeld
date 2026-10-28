import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism, cpus, loadavg, release, totalmem, type } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BenchError, errorCode } from './bench-error.ts';
import { serversFolder } from './server-process.ts';
import { displayPath } from './terminal.ts';
import type { BenchMachine, BenchSoftware } from './types.ts';

export interface Packages {
  readonly darkstart: string;
  readonly darkstartResolvedFrom: string;
  readonly fastify: string;
  readonly autocannon: string;
  readonly typebox: string;
  readonly fastJsonStringify: string;
}

const repositoryRoot = join(import.meta.dirname, '..');
const missingCodes = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED']);

const notInstalled = (name: string): BenchError =>
  new BenchError(3, `${name} is not installed. Run npm install at the repository root.`);

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const resolveFile = (name: string, resolve: () => string): string => {
  try {
    const resolved = resolve();
    return resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved;
  } catch (error) {
    const code = errorCode(error);
    if (code !== null && missingCodes.has(code)) {
      throw notInstalled(name);
    }
    throw error;
  }
};

const versionOf = (name: string, entryFile: string): string => {
  let folder = dirname(entryFile);
  while (folder !== dirname(folder)) {
    const text = readText(join(folder, 'package.json'));
    const manifest: unknown = text === null ? null : JSON.parse(text);
    if (
      typeof manifest === 'object' &&
      manifest !== null &&
      'name' in manifest &&
      manifest.name === name &&
      'version' in manifest &&
      typeof manifest.version === 'string'
    ) {
      return manifest.version;
    }
    folder = dirname(folder);
  }
  throw notInstalled(name);
};

export function resolvePackages(): Packages {
  const serverFile = resolveFile('@darkstart/core', () => import.meta.resolve('@darkstart/core/server'));
  const manifestFile = resolveFile('@darkstart/core', () => import.meta.resolve('@darkstart/core/package.json'));
  const coreRoot = dirname(manifestFile);
  const distFolder = join(coreRoot, 'dist');
  if (!serverFile.startsWith(`${distFolder}${sep}`)) {
    const top = relative(coreRoot, serverFile).split(sep)[0] ?? '';
    throw new BenchError(
      3,
      `@darkstart/core/server resolves to ${displayPath(join(coreRoot, top))}/, not to the build. The benchmark measures the package as it ships; remove the --conditions flag from NODE_OPTIONS.`,
    );
  }
  if (!existsSync(serverFile)) {
    throw new BenchError(
      3,
      `${displayPath(distFolder)}/ has no build. Run npm run bench, which builds the package first.`,
    );
  }
  const fastifyFile = resolveFile('fastify', () => import.meta.resolve('fastify'));
  const autocannonFile = resolveFile('autocannon', () => import.meta.resolve('autocannon'));
  const typeboxFile = resolveFile('typebox', () => import.meta.resolve('typebox'));
  const fastJsonStringifyFile = resolveFile('fast-json-stringify', () =>
    createRequire(serverFile).resolve('fast-json-stringify'),
  );
  return {
    darkstart: versionOf('@darkstart/core', manifestFile),
    darkstartResolvedFrom: displayPath(dirname(serverFile)),
    fastify: versionOf('fastify', fastifyFile),
    autocannon: versionOf('autocannon', autocannonFile),
    typebox: versionOf('typebox', typeboxFile),
    fastJsonStringify: versionOf('fast-json-stringify', fastJsonStringifyFile),
  };
}

export function nodeOptions(): string | null {
  const value = process.env.NODE_OPTIONS;
  return value === undefined || value === '' ? null : value;
}

const prettyName = (): string | null => {
  const text = readText('/etc/os-release');
  const line = text?.split('\n').find((candidate) => candidate.startsWith('PRETTY_NAME='));
  return line === undefined ? null : line.slice('PRETTY_NAME='.length).replace(/^"(.*)"$/, '$1');
};

const hypervisor = (): boolean | null => {
  const text = readText('/proc/cpuinfo');
  return text === null ? null : /^flags\s*:.*\bhypervisor\b/m.test(text);
};

export function loadAverage(): number {
  const [oneMinute] = loadavg();
  if (oneMinute === undefined) {
    throw new Error('os.loadavg() returned no 1-minute value');
  }
  return oneMinute;
}

export function captureMachine(loadAverageStart: number): Omit<BenchMachine, 'loadAverageEnd'> {
  return {
    cpuModel: cpus()[0]?.model ?? null,
    cores: availableParallelism(),
    memoryBytes: totalmem(),
    osName: prettyName(),
    kernel: `${type()} ${release()}`,
    virtualMachine: hypervisor(),
    loadAverageStart,
  };
}

const git = (args: readonly string[]): string | null => {
  try {
    return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || (error instanceof Error && 'status' in error)) {
      return null;
    }
    throw error;
  }
};

export function captureSoftware(packages: Packages): BenchSoftware {
  const revision = git(['rev-parse', '--short', 'HEAD'])?.trim() ?? null;
  const porcelain = revision === null ? null : git(['status', '--porcelain']);
  return {
    node: process.version,
    runnerCommandLine: [
      process.execPath,
      ...process.execArgv,
      displayPath(process.argv[1] ?? ''),
      ...process.argv.slice(2),
    ],
    serverCommandLine: [process.execPath, displayPath(join(serversFolder, '<server>.ts')), '--port', '0'],
    serverEnvironment: { NODE_ENV: 'production' },
    nodeOptions: nodeOptions(),
    darkstart: packages.darkstart,
    darkstartResolvedFrom: packages.darkstartResolvedFrom,
    revision,
    uncommittedChanges: porcelain === null ? null : porcelain.trim() !== '',
    fastify: packages.fastify,
    autocannon: packages.autocannon,
    typebox: packages.typebox,
    fastJsonStringify: packages.fastJsonStringify,
  };
}
