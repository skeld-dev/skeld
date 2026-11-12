// Does:  Measures the client bundle of the diverse fixture against Valibot and Zod Mini.
// Holds: A bundle that refuses a valid sample or accepts an invalid one is not compared.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import type { Json, Shape } from '../../tests/schema/diverse-fixture.ts';
import { invalidValue, sample, shapes } from '../../tests/schema/diverse-fixture.ts';

const bundleFlags = ['--bundle', '--minify', '--format=esm', '--platform=browser', '--target=es2022'];
const skeld = 'skeld';
const measures = ['minified', 'gzip', 'brotli'] as const;

type Measure = (typeof measures)[number];
type Sizes = Readonly<Record<Measure, number>>;

interface Built {
  readonly name: string;
  readonly code: Buffer;
  readonly sizes: Sizes;
}

function usage(message: string): never {
  process.stderr.write(`${message}\nusage: bundle.ts --comparators <dir>\n`);
  process.exit(2);
}

function comparatorsFolder(argv: readonly string[]): string {
  const at = argv.indexOf('--comparators');
  const folder = at === -1 ? undefined : argv[at + 1];
  if (folder === undefined) {
    return usage('--comparators <dir> is required');
  }
  return resolve(folder);
}

function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function declare(shape: Shape): string {
  switch (shape.kind) {
    case 'string':
      return 't.string({maxLength:64})';
    case 'number':
      return 't.number({minimum:0,maximum:1000000})';
    case 'boolean':
      return 't.boolean()';
    case 'literal':
      return `t.literal(${JSON.stringify(shape.value)})`;
    case 'array':
      return `t.array(${declare(shape.items)},{maxItems:${shape.maxItems}})`;
    case 'union':
      return `t.union([${shape.members.map(declare).join(',')}])`;
    case 'object':
      return `t.object({${shape.fields.map((field) => `${key(field.name)}:${field.optional ? `t.optional(${declare(field.shape)})` : declare(field.shape)}`).join(',')}})`;
    default:
      return shape satisfies never;
  }
}

function skeldEntry(): string {
  const lines = shapes.map((shape, index) => `const s${index}=${declare(shape)};`);
  const names = shapes.map((_, index) => `s${index}`).join(',');
  return `import * as t from '@skeld/core/schema';\n${lines.join('\n')}\nexport const V=[${names}].map((s)=>(x)=>'value' in s['~standard'].validate(x));\n`;
}

function minify(esbuild: string, resolveDir: string, source: string): Buffer {
  const run = spawnSync(esbuild, [...bundleFlags, '--log-level=warning'], {
    input: source,
    cwd: resolveDir,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`esbuild failed (${run.status}): ${run.stderr.toString().slice(0, 400)}`);
  }
  return run.stdout;
}

function measure(code: Buffer): Sizes {
  const gzip = spawnSync('gzip', ['-9', '-n', '-c'], { input: code, maxBuffer: 256 * 1024 * 1024 });
  if (gzip.status !== 0) {
    throw new Error('gzip failed');
  }
  const brotli = brotliCompressSync(code, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: code.length },
  });
  return { minified: code.length, gzip: gzip.stdout.length, brotli: brotli.length };
}

function comparatorEntries(folder: string): Promise<readonly { readonly name: string; readonly source: string }[]> {
  const directory = join(folder, 'bundle');
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.mjs'))
    .sort();
  return Promise.all(
    files.map(async (file) => {
      const loaded: unknown = await import(pathToFileURL(join(directory, file)).href);
      if (typeof loaded !== 'object' || loaded === null || !('entry' in loaded) || typeof loaded.entry !== 'function') {
        throw new TypeError(`${file} does not export entry(shapes)`);
      }
      const source: unknown = loaded.entry(shapes);
      if (typeof source !== 'string') {
        throw new TypeError(`${file}: entry(shapes) did not return source text`);
      }
      return { name: file.replace(/\.mjs$/, ''), source };
    }),
  );
}

interface Behaviour {
  readonly validAccepted: number;
  readonly validRefused: number;
  readonly invalidRefused: number;
  readonly invalidAccepted: number;
}

async function exercise(built: Built, scratch: string): Promise<Behaviour> {
  const file = join(scratch, `${built.name}.mjs`);
  writeFileSync(file, built.code);
  const loaded: unknown = await import(pathToFileURL(file).href);
  if (typeof loaded !== 'object' || loaded === null || !('V' in loaded) || !Array.isArray(loaded.V)) {
    throw new TypeError(`${built.name}: the bundle exports no V array`);
  }
  const checks: unknown[] = loaded.V;
  const count = { validAccepted: 0, validRefused: 0, invalidRefused: 0, invalidAccepted: 0 };
  checks.forEach((check, index) => {
    const shape = shapes[index];
    if (typeof check !== 'function' || shape === undefined) {
      throw new TypeError(`${built.name}: entry ${index} is not a check`);
    }
    const valid: Json = sample(index);
    const invalid = invalidValue(valid, shape, Math.floor(index / 4) % 5);
    if (check(valid) === true) {
      count.validAccepted++;
    } else {
      count.validRefused++;
    }
    if (check(invalid) === true) {
      count.invalidAccepted++;
    } else {
      count.invalidRefused++;
    }
  });
  return count;
}

function ratios(left: Sizes, right: Sizes): Record<Measure, number> {
  return {
    minified: Number((left.minified / right.minified).toFixed(3)),
    gzip: Number((left.gzip / right.gzip).toFixed(3)),
    brotli: Number((left.brotli / right.brotli).toFixed(3)),
  };
}

async function main(argv: readonly string[]): Promise<void> {
  const folder = comparatorsFolder(argv);
  const esbuild = join(folder, 'node_modules', '.bin', 'esbuild');
  const version = spawnSync(esbuild, ['--version']).stdout.toString().trim();
  const here = import.meta.dirname;
  const entries = [
    { name: skeld, source: skeldEntry(), resolveDir: here },
    ...(await comparatorEntries(folder)).map((entry) => ({ ...entry, resolveDir: join(folder, 'bundle') })),
  ];
  const built: Built[] = entries.map((entry) => {
    const code = minify(esbuild, entry.resolveDir, entry.source);
    return { name: entry.name, code, sizes: measure(code) };
  });
  const scratch = mkdtempSync(join(tmpdir(), 'ds-bundle-'));
  try {
    const behaviour = await Promise.all(built.map((item) => exercise(item, scratch)));
    const own = built.find((item) => item.name === skeld);
    if (own === undefined) {
      throw new RangeError('no bundle was built for the candidate');
    }
    const result = {
      esbuild: version,
      flags: bundleFlags.join(' '),
      schemas: shapes.length,
      distinctKeySets: new Set(
        shapes.map((shape) =>
          shape.kind === 'object'
            ? shape.fields
                .map((field) => field.name)
                .sort()
                .join(',')
            : '',
        ),
      ).size,
      bytes: Object.fromEntries(built.map((item) => [item.name, item.sizes])),
      ratios: Object.fromEntries(
        built
          .filter((item) => item.name !== skeld)
          .map((item) => [`${skeld}/${item.name}`, ratios(own.sizes, item.sizes)]),
      ),
      behaviour: Object.fromEntries(built.map((item, position) => [item.name, behaviour[position]])),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const unsound = behaviour.some((item) => item.validRefused > 0 || item.invalidAccepted > 0);
    if (unsound) {
      process.stderr.write('a bundle refused a valid sample or accepted an invalid one: its size is not comparable\n');
      process.exitCode = 1;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

await main(process.argv.slice(2));
