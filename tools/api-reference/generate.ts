// Does:  Generates the API reference pages from the public symbols, or checks the committed pages for drift.
// Holds: With --check nothing is written; a page that differs from a fresh run is reported and the exit is 1.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { display, type Entry, type PublicSymbol, type Refusal, root, walk } from './walk.ts';

interface Options {
  readonly packageDir: string;
  readonly out: string;
  readonly check: boolean;
}

interface Page {
  readonly path: string;
  readonly text: string;
}

const usage = 'usage: node tools/api-reference/generate.ts [--package <dir>] [--out <dir>] [--check] | --help\n';
const biome = join(root, 'node_modules/.bin/biome');
const defaultOut = join(root, 'docs/api');

function parseArgs(args: readonly string[]): Options | 'help' | undefined {
  if (args.length === 1 && args[0] === '--help') {
    return 'help';
  }
  const given = new Map<string, string>();
  let check = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check' && !check) {
      check = true;
      continue;
    }
    const match = /^--(package|out)(?:=(.*))?$/.exec(args[index] ?? '');
    const name = match?.[1];
    const value = match?.[2] ?? args[++index];
    if (name === undefined || value === undefined || value === '' || given.has(name)) {
      return undefined;
    }
    given.set(name, value);
  }
  return {
    packageDir: resolve(given.get('package') ?? join(root, 'packages/core')),
    out: resolve(given.get('out') ?? defaultOut),
    check,
  };
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|');
}

function fence(code: string): string {
  return `\`\`\`ts\n${code}\n\`\`\``;
}

function section(symbol: PublicSymbol): string {
  const parts = [`## ${symbol.name}`];
  const { block } = symbol;
  if (block !== undefined && block.summary !== '') {
    parts.push(block.summary);
  }
  if (block !== undefined && block.rules !== '') {
    parts.push(block.rules);
  }
  parts.push(fence(symbol.declaration));
  if (block?.example !== undefined && block.example !== '') {
    parts.push(fence(block.example));
  }
  if (block?.see !== undefined && block.see !== '') {
    parts.push(`See \`${block.see}\`.`);
  }
  if (symbol.fields.some((field) => field.block !== undefined)) {
    const rows = symbol.fields.map(
      (field) => `| \`${cell(field.name.slice(symbol.name.length + 1))}\` | ${cell(field.block?.summary ?? '')} |`,
    );
    parts.push(['| Field | Summary |', '| --- | --- |', ...rows].join('\n'));
  }
  parts.push(`Source: \`${symbol.file}:${symbol.line}\``);
  return parts.join('\n\n');
}

function renderPage(packageName: string, entry: Entry): string {
  const sections = entry.symbols.map(section);
  return `${[`# ${packageName}${entry.subpath.slice(1)}`, ...sections].join('\n\n')}\n`;
}

function format(page: Page, formatPath: string): Page | Refusal {
  const result = spawnSync(biome, ['format', `--stdin-file-path=${formatPath}`], {
    cwd: root,
    input: page.text,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error !== undefined) {
    return { refused: `Biome will not run (${display(biome)}): ${result.error.message}` };
  }
  if (result.status !== 0) {
    const reason = result.stderr.split('\n').find((line) => line.trim() !== '') ?? 'no error output';
    return { refused: `Biome could not format ${display(page.path)} (exit ${result.status}): ${reason.trim()}` };
  }
  return { path: page.path, text: result.stdout };
}

function notRun(reason: string): number {
  process.stderr.write(`Reference could not be generated: ${reason}\n`);
  return 3;
}

function checkPages(pages: readonly Page[]): number {
  const drifted = pages.filter((page) => !existsSync(page.path) || readFileSync(page.path, 'utf8') !== page.text);
  for (const page of drifted) {
    process.stderr.write(`drift: ${display(page.path)}\n`);
  }
  if (drifted.length > 0) {
    process.stderr.write(`Reference check failed: ${drifted.length} of ${pages.length} page(s) drift.\n`);
    return 1;
  }
  process.stdout.write(`Reference check passed: ${pages.length} page(s) match the sources.\n`);
  return 0;
}

async function main(args: readonly string[]): Promise<number> {
  const options = parseArgs(args);
  if (options === 'help') {
    process.stdout.write(usage);
    return 0;
  }
  if (options === undefined) {
    process.stderr.write(usage);
    return 2;
  }
  const result = await walk({ packageDir: options.packageDir });
  if ('refused' in result) {
    return notRun(result.refused);
  }
  const folder = join(options.out, result.packageFolder);
  const pages: Page[] = [];
  for (const entry of result.entries) {
    if (entry.subpath === '.' || !entry.subpath.startsWith('./')) {
      return notRun(`export ${entry.subpath} has no page name`);
    }
    const name = `${entry.subpath.slice(2)}.md`;
    const page = format(
      { path: join(folder, name), text: renderPage(result.packageName, entry) },
      join(defaultOut, result.packageFolder, name),
    );
    if ('refused' in page) {
      return notRun(page.refused);
    }
    pages.push(page);
  }
  if (options.check) {
    return checkPages(pages);
  }
  for (const page of pages) {
    mkdirSync(dirname(page.path), { recursive: true });
    writeFileSync(page.path, page.text);
  }
  process.stdout.write(`Reference written: ${pages.length} page(s) in ${display(folder)}.\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
