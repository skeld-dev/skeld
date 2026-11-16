// Does:  Runs the API-doc check on each package: every public symbol documented in at most three lines, examples run.
// Holds: Exit 0 only when no symbol has a finding; the first line of each block must equal the compiler's hover text.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExamples, type Finding, ruleOrder } from './examples.ts';
import { type PublicSymbol, type Refusal, root, walk } from './walk.ts';

interface Options {
  readonly packageDirs: readonly string[];
  readonly entry: string | undefined;
}

interface Checked {
  readonly symbols: number;
  readonly ran: number;
  readonly findings: readonly Finding[];
}

const usage = 'usage: node tools/api-reference/check.ts [--package <dir>] [--entry <file>] | --help\n';
const scratch = join(root, 'tools/.tsout/api-examples');
const allowedTags: ReadonlySet<string> = new Set(['throws', 'default', 'example', 'see']);

function parseArgs(args: readonly string[]): Options | 'help' | undefined {
  if (args.length === 1 && args[0] === '--help') {
    return 'help';
  }
  const given = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const match = /^--(package|entry)(?:=(.*))?$/.exec(args[index] ?? '');
    const name = match?.[1];
    const value = match?.[2] ?? args[++index];
    if (name === undefined || value === undefined || value === '' || given.has(name)) {
      return undefined;
    }
    given.set(name, value);
  }
  const entry = given.get('entry');
  const named = given.get('package');
  return {
    packageDirs:
      named !== undefined
        ? [resolve(named)]
        : entry !== undefined
          ? [packageFolder('@skeld/core')]
          : [packageFolder('@skeld/core'), join(root, 'packages/auth')],
    entry: entry === undefined ? undefined : resolve(entry),
  };
}

function packageFolder(name: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)));
}

// Does:  The folders of the workspace packages a package depends on, whose values its examples may also import.
function dependencyFolders(packageDir: string): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('dependencies' in manifest)) {
    return [];
  }
  const { dependencies } = manifest;
  if (typeof dependencies !== 'object' || dependencies === null) {
    return [];
  }
  return Object.keys(dependencies)
    .filter((name) => name.startsWith('@skeld/'))
    .map(packageFolder);
}

function flatten(symbols: readonly PublicSymbol[]): PublicSymbol[] {
  return symbols.flatMap((symbol) => [symbol, ...flatten(symbol.fields)]);
}

function unique(symbols: readonly PublicSymbol[]): PublicSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.file}:${symbol.line}:${symbol.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function blockFindings(symbol: PublicSymbol): Finding[] {
  const at = { file: symbol.file, line: symbol.line };
  const { block, name } = symbol;
  if (block === undefined) {
    return [{ ...at, rule: 'missing-block', text: `${name} has no doc block` }];
  }
  const findings: Finding[] = [];
  if (block.lines.length > 3) {
    findings.push({ ...at, rule: 'too-long', text: `${name}: ${block.lines.length} lines inside /** */, at most 3` });
  }
  const refused = [...new Set(block.tags.filter((tag) => !allowedTags.has(tag)))];
  if (refused.length > 0) {
    const tags = refused.map((tag) => `@${tag}`).join(', ');
    findings.push({ ...at, rule: 'tag', text: `${name}: ${tags} not allowed (@throws, @default, @example, @see)` });
  }
  if (symbol.callable && (block.example ?? '') === '' && block.see === undefined) {
    findings.push({ ...at, rule: 'example-missing', text: `${name} is a function with neither @example nor @see` });
  }
  const hover = symbol.documentation.split('\n')[0]?.trim() ?? '';
  const first = block.lines[0] ?? '';
  if (hover === '') {
    findings.push({ ...at, rule: 'hover-mismatch', text: `${name}: the compiler reads no documentation comment` });
  } else if (hover !== first) {
    findings.push({ ...at, rule: 'hover-mismatch', text: `${name}: hover reads "${hover}", block reads "${first}"` });
  }
  return findings;
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      ruleOrder.indexOf(a.rule) - ruleOrder.indexOf(b.rule) ||
      a.text.localeCompare(b.text),
  );
}

function notRun(reason: string): number {
  process.stderr.write(`API check could not run: ${reason}\n`);
  return 3;
}

async function checkPackage(
  packageDir: string,
  extra: { readonly file: string; readonly config: string } | undefined,
  abort: AbortSignal,
): Promise<Checked | Refusal> {
  const result = await walk(extra === undefined ? { packageDir } : { packageDir, extra });
  if ('refused' in result) {
    return result;
  }
  const imports = [{ packageName: result.packageName, entries: result.entries }];
  for (const folder of dependencyFolders(packageDir)) {
    // biome-ignore lint/performance/noAwaitInLoops: each walk opens its own compiler API, and two at once gain nothing.
    const dependency = await walk({ packageDir: folder });
    if ('refused' in dependency) {
      return dependency;
    }
    imports.push({ packageName: dependency.packageName, entries: dependency.entries });
  }
  const checked = result.extra === undefined ? result.entries.flatMap((entry) => entry.symbols) : result.extra.symbols;
  const symbols = unique(flatten(checked));
  const examples = await checkExamples(symbols, imports, join(scratch, result.packageFolder), abort);
  if ('refused' in examples) {
    return examples;
  }
  return {
    symbols: symbols.length,
    ran: examples.ran,
    findings: [...symbols.flatMap(blockFindings), ...examples.findings],
  };
}

async function check(options: Options, started: number, abort: AbortSignal): Promise<number> {
  let extra: { file: string; config: string } | undefined;
  if (options.entry !== undefined) {
    const config = join(scratch, 'entry', 'tsconfig.json');
    mkdirSync(join(scratch, 'entry'), { recursive: true });
    writeFileSync(
      config,
      `${JSON.stringify({ extends: join(root, 'tsconfig.base.json'), files: [options.entry] }, null, 2)}\n`,
    );
    extra = { file: options.entry, config };
  }
  let symbols = 0;
  let ran = 0;
  const all: Finding[] = [];
  for (const packageDir of options.packageDirs) {
    // biome-ignore lint/performance/noAwaitInLoops: one package at a time so its examples' 10 s limits share no load.
    const checked = await checkPackage(packageDir, extra, abort);
    if ('refused' in checked) {
      return notRun(checked.refused);
    }
    symbols += checked.symbols;
    ran += checked.ran;
    all.push(...checked.findings);
  }
  const findings = sortFindings(all);
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  const summary = `API check read ${symbols} symbols and ran ${ran} examples in ${seconds} s.\n`;
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(`${finding.file}:${finding.line} ${finding.rule}: ${finding.text}\n`);
    }
    process.stderr.write(summary);
    process.stderr.write(`API check failed: ${findings.length} finding(s).\n`);
    return 1;
  }
  process.stdout.write(summary);
  process.stdout.write(`API check passed: ${symbols} symbols, ${ran} examples run.\n`);
  return 0;
}

async function main(args: readonly string[]): Promise<number> {
  const started = performance.now();
  const options = parseArgs(args);
  if (options === 'help') {
    process.stdout.write(usage);
    return 0;
  }
  if (options === undefined) {
    process.stderr.write(usage);
    return 2;
  }
  const abort = new AbortController();
  const stop = (signal: NodeJS.Signals): void => {
    abort.abort();
    rmSync(scratch, { recursive: true, force: true });
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.kill(process.pid, signal);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    return await check(options, started, abort.signal);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

process.exitCode = await main(process.argv.slice(2));
