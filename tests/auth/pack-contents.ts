// Does:  Proves the packed core and auth tarballs ship the contracted subpaths and run in a consumer.
// Holds: Packing, unpacking and installing happen in a folder outside the repository, which is removed at the end.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from './rig/v1-report.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

const authSubpaths = [
  'server',
  'policy',
  'routes',
  'auth-error',
  'store',
  'sqlite',
  'postgres',
  'store-conformance',
  'api-key',
  'jwt',
  'oidc',
  'password',
];

function run(command: string, args: readonly string[], cwd: string): { status: number | null; out: string } {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function manifestOf(dir: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package/package.json'), 'utf8'));
  return typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
}

function exportsOf(manifest: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const table: unknown = manifest.exports;
  return new Map(
    typeof table === 'object' && table !== null
      ? Object.entries(table).map(([key, value]) => [
          key,
          typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {},
        ])
      : [],
  );
}

const report = createReport(
  'v09',
  'the packed @skeld/auth ships exactly the twelve contracted subpaths with a default and a types target each, no recorder; @skeld/core ships ./gate with no runtime dependency; a consumer outside the workspace installs both and imports every subpath at run time',
);
const scratch = mkdtempSync(join(tmpdir(), 'skeld-v09-pack-'));
try {
  const tarDir = join(scratch, 'tarballs');
  mkdirSync(tarDir);
  const packed = ['@skeld/core', '@skeld/auth'].map((name) =>
    run('pnpm', ['--filter', name, 'pack', '--pack-destination', tarDir], root),
  );
  report.check(
    'pnpm pack of both packages succeeds',
    packed.every((result) => result.status === 0),
    packed.map((result) => String(result.status)).join(','),
  );
  const tarballs = readdirSync(tarDir).sort();
  const coreTar = tarballs.find((name) => name.startsWith('skeld-core-'));
  const authTar = tarballs.find((name) => name.startsWith('skeld-auth-'));
  if (coreTar === undefined || authTar === undefined) {
    throw new Error(`tarballs: ${tarballs.join(',')}`);
  }
  // Why: All distribution checks inspect the same two artifacts; none repacks the workspace.
  const markers = run('node', ['tools/check-pack-markers.ts', join(tarDir, coreTar), join(tarDir, authTar)], root);
  report.check(
    'the marker and export checks pass on both prepared artifacts',
    markers.status === 0,
    markers.out.slice(-300),
  );
  const consumerLib = run('node', ['tools/check-consumer-lib.ts', '--packed-dir', tarDir], root);
  report.check(
    'the consumer declaration checks pass on the same artifacts',
    consumerLib.status === 0,
    consumerLib.out.slice(-300),
  );

  const unpack = (tar: string, into: string): void => {
    mkdirSync(into);
    const result = run('tar', ['-xzf', join(tarDir, tar), '-C', into], scratch);
    if (result.status !== 0) {
      throw new Error(`tar failed: ${result.out}`);
    }
  };
  const coreDir = join(scratch, 'core');
  const authDir = join(scratch, 'auth');
  unpack(coreTar, coreDir);
  unpack(authTar, authDir);
  const authFiles = filesUnder(authDir).map((file) => relative(join(authDir, 'package'), file));
  const coreFiles = filesUnder(coreDir).map((file) => relative(join(coreDir, 'package'), file));
  report.note(`tarballs: ${coreTar} (${coreFiles.length} files), ${authTar} (${authFiles.length} files)`);

  const authManifest = manifestOf(authDir);
  const authExports = exportsOf(authManifest);
  const wanted = [...authSubpaths.map((name) => `./${name}`), './package.json'];
  report.check(
    '@skeld/auth exports exactly the twelve contracted subpaths and ./package.json, and no ./hashing',
    [...authExports.keys()].sort().join(',') === [...wanted].sort().join(',') && !authExports.has('./hashing'),
    [...authExports.keys()].join(','),
  );
  const incomplete = [...authExports.entries()].filter(([key, conditions]) => {
    if (key === './package.json') {
      return false;
    }
    const types = conditions.types;
    const standard = conditions.default;
    return (
      typeof types !== 'string' ||
      typeof standard !== 'string' ||
      !authFiles.includes(types.replace(/^\.\//, '')) ||
      !authFiles.includes(standard.replace(/^\.\//, ''))
    );
  });
  report.check(
    'every auth subpath has a default and a types target and both files are in the tarball',
    incomplete.length === 0,
    incomplete.map(([key]) => key).join(',') || 'all present',
  );
  report.check(
    "@skeld/auth depends on @skeld/core alone, at exactly the packed core tarball's version: no range, no peer, optional or other dependency",
    /^\d+\.\d+\.\d+$/.test(String(manifestOf(coreDir).version)) &&
      JSON.stringify(authManifest.dependencies) === JSON.stringify({ '@skeld/core': manifestOf(coreDir).version }) &&
      authManifest.peerDependencies === undefined &&
      authManifest.optionalDependencies === undefined,
    JSON.stringify(authManifest.dependencies),
  );
  const recorderFiles = authFiles.filter((file) => /recorder/i.test(file));
  const diagFiles = authFiles.filter((file) => file.startsWith('dist/diag/'));
  report.check(
    'no recorder file ships in @skeld/auth, and dist/diag holds only the empty module and its declaration',
    recorderFiles.length === 0 && diagFiles.sort().join(',') === 'dist/diag/empty.d.ts,dist/diag/empty.js',
    `recorder files ${recorderFiles.length}; dist/diag: ${diagFiles.join(',')}`,
  );
  report.check(
    'the published #diag target is the empty module and no skeld-diag recorder is loaded by default',
    JSON.stringify(authManifest.imports).includes('./dist/diag/empty.js'),
    JSON.stringify(authManifest.imports).slice(0, 200),
  );
  const emptyText = readFileSync(join(authDir, 'package/dist/diag/empty.js'), 'utf8');
  report.check(
    'dist/diag/empty.js has no file, process or timer access: it is empty functions',
    !/node:fs|process\./.test(emptyText) && !/setInterval|appendFileSync/.test(emptyText),
    `${emptyText.length} bytes`,
  );

  const coreManifest = manifestOf(coreDir);
  const coreExports = exportsOf(coreManifest);
  const gate = coreExports.get('./gate');
  report.check(
    '@skeld/core ships ./gate with a default and a types target in the tarball',
    gate !== undefined &&
      typeof gate.default === 'string' &&
      typeof gate.types === 'string' &&
      coreFiles.includes(String(gate.default).replace(/^\.\//, '')) &&
      coreFiles.includes(String(gate.types).replace(/^\.\//, '')),
    JSON.stringify(gate),
  );
  report.check(
    '@skeld/core has no runtime dependency: no dependencies, peerDependencies or optionalDependencies',
    ['dependencies', 'peerDependencies', 'optionalDependencies'].every((key) => {
      const value = coreManifest[key];
      return value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0);
    }),
    JSON.stringify([coreManifest.dependencies, coreManifest.peerDependencies, coreManifest.optionalDependencies]),
  );

  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'consumer',
      private: true,
      type: 'module',
    }),
  );
  const install = run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--ignore-scripts', join(tarDir, authTar), join(tarDir, coreTar)],
    consumer,
  );
  report.check(
    'a fresh folder outside the workspace installs both tarballs with npm',
    install.status === 0 &&
      existsSync(join(consumer, 'node_modules/@skeld/auth/package.json')) &&
      existsSync(join(consumer, 'node_modules/@skeld/core/package.json')),
    install.out.trim().split('\n').slice(-2).join(' | ').slice(0, 300),
  );
  const installedVersion = (name: string): string => {
    const parsed: unknown = JSON.parse(readFileSync(join(consumer, 'node_modules', name, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? String(Reflect.get(parsed, 'version')) : '';
  };
  const copied = ['@skeld/core', '@skeld/auth'].every(
    (name) => !lstatSync(join(consumer, 'node_modules', name)).isSymbolicLink(),
  );
  report.check(
    'the installed packages are copies of the tarballs (not links into the repository) at the packed versions',
    copied &&
      installedVersion('@skeld/core') === String(coreManifest.version) &&
      installedVersion('@skeld/auth') === String(authManifest.version),
    `core ${installedVersion('@skeld/core')}, auth ${installedVersion('@skeld/auth')}`,
  );

  const subpaths = [...authExports.keys()]
    .map((key) => `@skeld/auth/${key.slice(2)}`)
    .concat(
      [...coreExports.entries()]
        .filter(([key, conditions]) => key === './package.json' || typeof conditions.default === 'string')
        .map(([key]) => `@skeld/core/${key.slice(2)}`),
    );
  writeFileSync(
    join(consumer, 'check.mjs'),
    `const names = ${JSON.stringify(subpaths)};\nconst out = [];\nfor (const name of names) {\n  try {\n    const mod = name.endsWith('/package.json') ? { default: (await import(name, { with: { type: 'json' } })).default } : await import(name);\n    out.push([name, Object.keys(mod).sort()]);\n  } catch (error) {\n    out.push([name, 'ERROR ' + (error && error.code ? error.code : String(error))]);\n  }\n}\nprocess.stdout.write(JSON.stringify(out));\n`,
  );
  const imported = run('node', ['check.mjs'], consumer);
  let results: [string, unknown][] = [];
  try {
    const parsed: unknown = JSON.parse(imported.out);
    results = Array.isArray(parsed) ? parsed.map((entry) => [String(entry[0]), entry[1]]) : [];
  } catch {
    results = [];
  }
  report.check(
    `the consumer imports every subpath at run time (${results.length} of ${subpaths.length}: ${authExports.size} of auth, ${subpaths.length - authExports.size} of core; ./generated-check is source-only by design and has no default target)`,
    imported.status === 0 && results.length === subpaths.length && results.every(([, value]) => Array.isArray(value)),
    results
      .filter(([, value]) => !Array.isArray(value))
      .map(([name, value]) => `${name}: ${String(value)}`)
      .join('; ') || 'no import failed',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
report.finish();
