// Does:  Checks the instrumentation map against the engine's source: every row has its hook and every hook its row.
// Holds: The source is read with TypeScript's scanner as text; nothing from packages/core is imported or run.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import type { SyntaxKind } from 'typescript/unstable/ast';

type ScannerModule = typeof import('typescript/unstable/ast/scanner');
type Kinds = typeof import('typescript/unstable/ast')['SyntaxKind'];
type TokenType = 'word' | 'string' | 'head' | 'middle' | 'tail' | 'punct';

interface Token {
  readonly type: TokenType;
  readonly text: string;
  readonly line: number;
}

type Tokenize = (text: string) => readonly Token[];

interface Call {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

interface SourceFile {
  readonly tokens: readonly Token[];
  readonly declared: ReadonlySet<string>;
  readonly literals: ReadonlySet<string>;
}

interface Source {
  readonly files: ReadonlyMap<string, SourceFile>;
  readonly calls: readonly Call[];
  readonly dynamic: readonly Call[];
}

interface Reference {
  readonly path: string;
  readonly ident: string;
  readonly qualifier: string | undefined;
}

type Anchor =
  | { readonly kind: 'recorder' }
  | { readonly kind: 'derived'; readonly hooks: readonly string[] }
  | { readonly kind: 'code'; readonly refs: readonly Reference[] };

interface Invalid {
  readonly kind: 'invalid';
  readonly reason: string;
}

interface Row {
  readonly name: string;
  readonly line: number;
  readonly status: 'planned' | 'built' | undefined;
  readonly anchor: Anchor | undefined;
}

interface MapRead {
  readonly rows: readonly Row[];
  readonly tables: number;
}

interface Problem {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const root = resolve(import.meta.dirname, '..');
const usage = 'usage: node tools/check-instrumentation-map.ts [--map <file>] [--src <dir>] | --help\n';
const hookPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const identPattern = /^[A-Za-z_$][\w$]*$/;
const pathRefPattern = /^((?:[a-z0-9-]+\/)+[a-z0-9-]+\.ts) › ([A-Za-z_$][\w$]*)$/;
const refPattern = /^`([^`]+)`(?: `([A-Za-z_$][\w$]*)`)?(?: \(.*\))?$/;
const ruleTitles: Readonly<Record<string, string>> = {
  R1: 'format',
  R2: 'name',
  R3: 'duplicate',
  R4: 'unmapped',
  R5: 'dynamic',
  R6: 'anchor',
  R7: 'derived',
  R8: 'not in code',
  R9: 'planned',
  R10: 'placement',
};
const namePosition: Readonly<Record<string, number>> = { start: 0, track: 0, count: 0, event: 0, limit: 0, next: 1 };
const declarationKeywords = new Set(['function', 'class', 'const', 'let', 'var']);
const topLevelStarts = new Set([...declarationKeywords, 'export', 'import', 'interface', 'type']);
const memberPrefixes = new Set(['{', ',', ';', '}']);
const modifiers = new Set([
  'async',
  'get',
  'set',
  'static',
  'readonly',
  'public',
  'private',
  'protected',
  'override',
  '*',
]);

function parseArgs(args: readonly string[]): { map: string; src: string } | 'help' | undefined {
  if (args.length === 1 && args[0] === '--help') {
    return 'help';
  }
  const given = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const match = /^--(map|src)(?:=(.*))?$/.exec(args[index] ?? '');
    const name = match?.[1];
    const value = match?.[2] ?? args[++index];
    if (name === undefined || value === undefined || value === '' || given.has(name)) {
      return undefined;
    }
    given.set(name, value);
  }
  return {
    map: resolve(given.get('map') ?? join(root, '.project/instrumentation-map.md')),
    src: resolve(given.get('src') ?? join(root, 'packages/core/src')),
  };
}

function lineFinder(lineStarts: readonly number[]): (offset: number) => number {
  return (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((lineStarts[middle] ?? 0) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
}

function tokenType(kind: SyntaxKind, kinds: Kinds, scanner: ScannerModule): TokenType {
  if (kind === kinds.StringLiteral || kind === kinds.NoSubstitutionTemplateLiteral) {
    return 'string';
  }
  if (scanner.tokenIsIdentifierOrKeyword(kind)) {
    return 'word';
  }
  if (kind === kinds.TemplateHead) {
    return 'head';
  }
  if (kind === kinds.TemplateMiddle) {
    return 'middle';
  }
  return kind === kinds.TemplateTail ? 'tail' : 'punct';
}

function tokenize(
  text: string,
  scannerModule: ScannerModule,
  kinds: Kinds,
  endsExpression: ReadonlySet<SyntaxKind>,
): Token[] {
  const scanner = scannerModule.createScanner(true, undefined, text);
  const lineOf = lineFinder(scannerModule.computeLineStarts(text));
  const tokens: Token[] = [];
  const braces: boolean[] = [];
  let previous: SyntaxKind = kinds.Unknown;
  let kind: SyntaxKind = scanner.scan();
  while (kind !== kinds.EndOfFile) {
    if ((kind === kinds.SlashToken || kind === kinds.SlashEqualsToken) && !endsExpression.has(previous)) {
      kind = scanner.reScanSlashToken();
    }
    if (kind === kinds.OpenBraceToken || kind === kinds.TemplateHead) {
      braces.push(kind === kinds.TemplateHead);
    } else if (kind === kinds.CloseBraceToken && braces.pop() === true) {
      kind = scanner.reScanTemplateToken(false);
      if (kind === kinds.TemplateMiddle) {
        braces.push(true);
      }
    }
    const type = tokenType(kind, kinds, scannerModule);
    const value = type === 'string' || type === 'word' ? scanner.getTokenValue() : scanner.getTokenText();
    tokens.push({ type, text: value, line: lineOf(scanner.getTokenStart()) });
    previous = kind;
    kind = scanner.scan();
  }
  return tokens;
}

async function loadTokenizer(): Promise<Tokenize | string> {
  try {
    const [scannerModule, { SyntaxKind: kinds }] = await Promise.all([
      import('typescript/unstable/ast/scanner'),
      import('typescript/unstable/ast'),
    ]);
    const endsExpression: ReadonlySet<SyntaxKind> = new Set([
      kinds.Identifier,
      kinds.StringLiteral,
      kinds.NumericLiteral,
      kinds.BigIntLiteral,
      kinds.NoSubstitutionTemplateLiteral,
      kinds.TemplateTail,
      kinds.RegularExpressionLiteral,
      kinds.CloseParenToken,
      kinds.CloseBracketToken,
      kinds.CloseBraceToken,
      kinds.ThisKeyword,
      kinds.SuperKeyword,
      kinds.TrueKeyword,
      kinds.FalseKeyword,
      kinds.NullKeyword,
      kinds.PlusPlusToken,
      kinds.MinusMinusToken,
    ]);
    return (text) => tokenize(text, scannerModule, kinds, endsExpression);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function sourcePaths(dir: string, prefix = ''): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...sourcePaths(join(dir, entry.name), path));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      paths.push(path);
    }
  }
  return paths;
}

function is(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.type !== 'string' && token.text === text;
}

function opens(token: Token | undefined): boolean {
  return token?.type === 'head' || is(token, '(') || is(token, '[') || is(token, '{');
}

function closes(token: Token | undefined): boolean {
  return token?.type === 'tail' || is(token, ')') || is(token, ']') || is(token, '}');
}

function closing(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    if (opens(tokens[index])) {
      depth++;
    } else if (closes(tokens[index])) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return tokens.length;
}

function entries(tokens: readonly Token[], open: number): Token[][] {
  const end = closing(tokens, open);
  const list: Token[][] = [];
  let start = open + 1;
  let index = start;
  while (index < end) {
    const token = tokens[index];
    if (is(token, ',')) {
      list.push(tokens.slice(start, index));
      start = index + 1;
    }
    index = opens(token) ? closing(tokens, index) + 1 : index + 1;
  }
  list.push(tokens.slice(start, end));
  return list;
}

function argumentAt(tokens: readonly Token[], open: number, position: number): readonly Token[] {
  return entries(tokens, open)[position] ?? [];
}

function specifiers(clause: readonly Token[], open: number): Token[][] {
  const list: Token[][] = [[]];
  for (const token of clause.slice(open + 1, closing(clause, open))) {
    if (is(token, ',')) {
      list.push([]);
    } else {
      list.at(-1)?.push(token);
    }
  }
  return list;
}

function importClause(clause: readonly Token[], bindings: Map<string, string>, namespaces: Set<string>): void {
  if (is(clause[0], 'type') && clause.length > 1 && !is(clause[1], ',')) {
    return;
  }
  clause.forEach((token, index) => {
    const alias = clause[index + 2];
    if (is(token, '*') && is(clause[index + 1], 'as') && alias !== undefined) {
      namespaces.add(alias.text);
    }
    if (!is(token, '{')) {
      return;
    }
    for (const specifier of specifiers(clause, index)) {
      const [first] = specifier;
      const typeOnly = is(first, 'type') && (specifier.length === 2 || specifier.length === 4);
      if (first !== undefined && !typeOnly) {
        const local = is(specifier.at(-2), 'as') ? specifier.at(-1) : first;
        bindings.set(local?.text ?? first.text, first.text);
      }
    }
  });
}

function fromDiag(tokens: readonly Token[], index: number): boolean {
  const target = tokens[index + 1];
  return is(tokens[index], 'from') && target?.type === 'string' && target.text === '#diag';
}

function importsDiagDynamically(tokens: readonly Token[], index: number): boolean {
  const target = tokens[index + 2];
  return (
    is(tokens[index], 'import') && is(tokens[index + 1], '(') && target?.type === 'string' && target.text === '#diag'
  );
}

function staticImportEnd(tokens: readonly Token[], index: number): number {
  let end = index + 1;
  while (end < tokens.length && !is(tokens[end], ';') && !is(tokens[end], 'from') && tokens[end]?.type !== 'string') {
    end++;
  }
  return end;
}

function reExportsDiag(tokens: readonly Token[], index: number): boolean {
  let start = is(tokens[index + 1], 'type') ? index + 2 : index + 1;
  if (is(tokens[start], '{')) {
    start = closing(tokens, start) + 1;
  } else if (is(tokens[start], '*')) {
    start += is(tokens[start + 1], 'as') ? 3 : 1;
  } else {
    return false;
  }
  return fromDiag(tokens, start);
}

function scanImports(tokens: readonly Token[], file: string, dynamic: Call[]): [Map<string, string>, Set<string>] {
  const bindings = new Map<string, string>();
  const namespaces = new Set<string>();
  tokens.forEach((token, index) => {
    if (importsDiagDynamically(tokens, index)) {
      dynamic.push({ name: 'dynamic import of #diag', file, line: token.line });
    } else if (is(token, 'import') && !is(tokens[index + 1], '(') && !is(tokens[index + 1], '.')) {
      const end = staticImportEnd(tokens, index);
      if (fromDiag(tokens, end)) {
        importClause(tokens.slice(index + 1, end), bindings, namespaces);
      }
    } else if (is(token, 'export') && reExportsDiag(tokens, index)) {
      dynamic.push({ name: 're-export of #diag', file, line: token.line });
    }
  });
  return [bindings, namespaces];
}

function calledHook(
  tokens: readonly Token[],
  index: number,
  bindings: ReadonlyMap<string, string>,
  namespaces: ReadonlySet<string>,
): { imported: string; open: number } | undefined {
  const token = tokens[index];
  const previous = tokens[index - 1];
  if (token?.type !== 'word' || is(previous, '.') || is(previous, '?.')) {
    return undefined;
  }
  const bound = bindings.get(token.text);
  if (bound !== undefined && is(tokens[index + 1], '(')) {
    return { imported: bound, open: index + 1 };
  }
  const member = tokens[index + 2];
  if (namespaces.has(token.text) && is(tokens[index + 1], '.') && member !== undefined && is(tokens[index + 3], '(')) {
    return { imported: member.text, open: index + 3 };
  }
  return undefined;
}

function scanCalls(tokens: readonly Token[], file: string, calls: Call[], dynamic: Call[]): void {
  const [bindings, namespaces] = scanImports(tokens, file, dynamic);
  tokens.forEach((token, index) => {
    const hook = calledHook(tokens, index, bindings, namespaces);
    const position = hook === undefined ? undefined : namePosition[hook.imported];
    if (hook === undefined || position === undefined) {
      return;
    }
    const argument = argumentAt(tokens, hook.open, position);
    const [first] = argument;
    if (argument.length === 1 && first?.type === 'string') {
      calls.push({ name: first.text, file, line: first.line });
    } else {
      dynamic.push({
        name: `${hook.imported} name argument is not a string literal`,
        file,
        line: first?.line ?? token.line,
      });
    }
  });
}

function declaresMember(tokens: readonly Token[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  const memberStart =
    previous !== undefined &&
    previous.type !== 'string' &&
    (memberPrefixes.has(previous.text) || modifiers.has(previous.text));
  if (!memberStart) {
    return false;
  }
  if (is(next, ':') || (is(next, '?') && (is(tokens[index + 2], ':') || is(tokens[index + 2], '(')))) {
    return true;
  }
  const after = is(next, '(') ? tokens[closing(tokens, index + 1) + 1] : undefined;
  return is(after, '{') || is(after, ':');
}

function scanDeclarations(tokens: readonly Token[]): Set<string> {
  const declared = new Set<string>();
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const keyword = previous?.type === 'word' && declarationKeywords.has(previous.text);
    const generator = is(previous, '*') && is(tokens[index - 2], 'function');
    if (token.type === 'word' && (keyword || generator || declaresMember(tokens, index))) {
      declared.add(token.text);
    }
  });
  return declared;
}

function readSource(src: string, tokenizer: Tokenize): Source {
  const files = new Map<string, SourceFile>();
  const calls: Call[] = [];
  const dynamic: Call[] = [];
  for (const path of sourcePaths(src)) {
    const tokens = tokenizer(readFileSync(join(src, path), 'utf8'));
    scanCalls(tokens, path, calls, dynamic);
    files.set(path, {
      tokens,
      declared: scanDeclarations(tokens),
      literals: new Set(tokens.filter((token) => token.type === 'string').map((token) => token.text)),
    });
  }
  return { files, calls, dynamic };
}

function depthsOf(tokens: readonly Token[]): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (closes(token)) {
      depth--;
    }
    depths.push(depth);
    if (opens(token)) {
      depth++;
    }
  }
  return depths;
}

function returnedLiteral(tokens: readonly Token[], name: string): number | undefined {
  const depths = depthsOf(tokens);
  const start = tokens.findIndex(
    (token, index) => depths[index] === 0 && is(token, 'function') && is(tokens[index + 1], name),
  );
  if (start === -1) {
    return undefined;
  }
  let end = start + 2;
  while (end < tokens.length && !(depths[end] === 0 && topLevelStarts.has(tokens[end]?.text ?? ''))) {
    end++;
  }
  const returns = tokens.slice(start, end).flatMap((token, index) => (is(token, 'return') ? [start + index] : []));
  const [only] = returns;
  return returns.length === 1 && only !== undefined && is(tokens[only + 1], '{') ? only + 1 : undefined;
}

function literalSource(
  path: string,
  name: string,
  files: ReadonlyMap<string, SourceFile>,
): { path: string; open: number } | undefined {
  const tokens = files.get(path)?.tokens ?? [];
  const local = returnedLiteral(tokens, name);
  if (local !== undefined) {
    return { path, open: local };
  }
  for (const [index, token] of tokens.entries()) {
    if (!is(token, 'import') || is(tokens[index + 1], '(') || is(tokens[index + 1], '.')) {
      continue;
    }
    const end = staticImportEnd(tokens, index);
    const target = tokens[end + 1];
    if (!is(tokens[end], 'from') || target?.type !== 'string' || !target.text.startsWith('.')) {
      continue;
    }
    const bindings = new Map<string, string>();
    importClause(tokens.slice(index + 1, end), bindings, new Set());
    const imported = bindings.get(name);
    if (imported !== undefined) {
      const from = posix.normalize(posix.join(posix.dirname(path), target.text));
      const open = returnedLiteral(files.get(from)?.tokens ?? [], imported);
      return open === undefined ? undefined : { path: from, open };
    }
  }
  return undefined;
}

function calleeOf(value: readonly Token[], tokens: readonly Token[]): string | undefined {
  const [first, second] = value;
  if (first?.type !== 'word') {
    return undefined;
  }
  if (is(second, '(') && closing(value, 1) === value.length - 1) {
    return first.text;
  }
  const bound = tokens.flatMap((token, index) =>
    value.length === 1 &&
    is(token, first.text) &&
    is(tokens[index - 1], 'const') &&
    is(tokens[index + 1], '=') &&
    tokens[index + 2]?.type === 'word' &&
    is(tokens[index + 3], '(') &&
    is(tokens[closing(tokens, index + 3) + 1], ';')
      ? [tokens[index + 2]?.text ?? '']
      : [],
  );
  return bound.length === 1 ? bound[0] : undefined;
}

function addPaths(
  at: { path: string; open: number },
  prefix: string,
  files: ReadonlyMap<string, SourceFile>,
  found: { names: Set<string>; seen: Set<string> },
): void {
  const tokens = files.get(at.path)?.tokens ?? [];
  const key = `${at.path}:${at.open}`;
  if (found.seen.has(key)) {
    return;
  }
  found.seen.add(key);
  for (const entry of entries(tokens, at.open)) {
    const [head, colon] = entry;
    const shorthand = entry.length === 1 && head?.type === 'word';
    if (head === undefined || (head.type !== 'word' && head.type !== 'string') || (!shorthand && !is(colon, ':'))) {
      continue;
    }
    const name = prefix === '' ? head.text : `${prefix}.${head.text}`;
    found.names.add(name);
    const value = shorthand ? entry : entry.slice(2);
    const [open] = value;
    const callee = calleeOf(value, tokens);
    const next =
      open !== undefined && is(open, '{') && closing(value, 0) === value.length - 1
        ? { path: at.path, open: tokens.indexOf(open) }
        : callee === undefined
          ? undefined
          : literalSource(at.path, callee, files);
    if (next !== undefined) {
      addPaths(next, name, files, found);
    }
  }
}

function recorderNames(files: ReadonlyMap<string, SourceFile>): Set<string> {
  const found = { names: new Set<string>(), seen: new Set<string>() };
  for (const [path, file] of files) {
    if (!path.startsWith('diag/')) {
      continue;
    }
    for (const literal of file.literals) {
      found.names.add(literal);
    }
    file.tokens.forEach((token, index) => {
      const composed = token.type === 'head' ? /^`([a-z][a-z0-9_.]*)\{\$\{$/.exec(token.text)?.[1] : undefined;
      if (composed !== undefined && file.tokens[closing(file.tokens, index)]?.text === '}}`') {
        found.names.add(composed);
      }
      const stringified =
        is(token, 'JSON') &&
        is(file.tokens[index + 1], '.') &&
        is(file.tokens[index + 2], 'stringify') &&
        is(file.tokens[index + 3], '(') &&
        is(file.tokens[index + 4], '{');
      if (stringified) {
        addPaths({ path, open: index + 4 }, '', files, found);
      }
    });
  }
  return found.names;
}

function cells(line: string): string[] {
  const body = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'));
}

function splitOutside(text: string): string[] | undefined {
  const items: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '`') {
      quoted = !quoted;
    } else if (!quoted && char === '(') {
      depth++;
    } else if (!quoted && char === ')') {
      depth--;
    }
    if (!quoted && depth === 0 && (char === ',' || char === ';') && text[index + 1] === ' ') {
      items.push(current);
      current = '';
      index++;
    } else {
      current += char;
    }
  }
  items.push(current);
  return quoted || depth !== 0 ? undefined : items;
}

function parseRefs(cell: string): Anchor | Invalid {
  const items = splitOutside(cell);
  if (items === undefined) {
    return { kind: 'invalid', reason: 'unbalanced backticks or parentheses' };
  }
  const refs: Reference[] = [];
  let path: string | undefined;
  for (const item of items) {
    const match = refPattern.exec(item);
    const target = match?.[1] ?? '';
    const pathRef = pathRefPattern.exec(target);
    path = pathRef?.[1] ?? path;
    const ident = pathRef?.[2] ?? (identPattern.test(target) ? target : undefined);
    if (match === null || ident === undefined || path === undefined) {
      return { kind: 'invalid', reason: `item "${item}" is neither \`path › ident\` nor an identifier after one` };
    }
    refs.push({ path, ident, qualifier: match[2] });
  }
  return { kind: 'code', refs };
}

function parseAnchor(cell: string): Anchor | Invalid {
  if (/^recorder(?:: .+)?$/.test(cell)) {
    return { kind: 'recorder' };
  }
  if (!cell.startsWith('derived from ')) {
    return parseRefs(cell);
  }
  const items = splitOutside(cell.slice('derived from '.length));
  if (items === undefined) {
    return { kind: 'invalid', reason: 'unbalanced backticks or parentheses' };
  }
  const hooks: string[] = [];
  for (const [index, item] of items.entries()) {
    const text = index === items.length - 1 ? item.replace(/ \([^`]*\)$/, '') : item;
    const name = /^`([^`]+)`$/.exec(text)?.[1] ?? text;
    if (!hookPattern.test(name)) {
      return { kind: 'invalid', reason: `derived from item "${item}" is not a hook name` };
    }
    hooks.push(name);
  }
  return { kind: 'derived', hooks };
}

function readRow(
  row: readonly string[],
  line: number,
  header: readonly string[],
  problem: (rule: string, message: string) => void,
): Row | undefined {
  const name = /^`([^`]+)`$/.exec(row[0] ?? '')?.[1];
  if (name === undefined) {
    problem('R1', `bad Hook cell "${row[0] ?? ''}"`);
    return undefined;
  }
  if (!hookPattern.test(name)) {
    problem('R2', `row name ${name} breaks the hook-name pattern`);
  }
  const statusColumn = header.indexOf('Status');
  const anchorColumn = header.indexOf('Anchor');
  const statusCell = statusColumn === -1 ? undefined : row[statusColumn];
  const status = statusCell === 'planned' || statusCell === 'built' ? statusCell : undefined;
  if (statusColumn !== -1 && status === undefined) {
    problem('R1', `${name}: bad Status cell "${statusCell ?? ''}"`);
  }
  const anchor = anchorColumn === -1 ? { kind: 'recorder' as const } : parseAnchor(row[anchorColumn] ?? '');
  if (anchor.kind === 'invalid') {
    problem('R1', `${name}: bad Anchor cell: ${anchor.reason}`);
    return { name, line, status, anchor: undefined };
  }
  return { name, line, status, anchor };
}

function readMap(text: string, mapFile: string, problems: Problem[]): MapRead {
  const lines = text.split('\n');
  const rows: Row[] = [];
  let tables = 0;
  let index = 0;
  while (index < lines.length) {
    const header = cells(lines[index] ?? '');
    const isTable = (lines[index] ?? '').trim().startsWith('|') && /^\s*\|?\s*:?-+/.test(lines[index + 1] ?? '');
    if (!isTable || header[0] !== 'Hook') {
      index++;
      continue;
    }
    tables++;
    if (!header.includes('Status')) {
      problems.push({ rule: 'R1', file: mapFile, line: index + 1, message: 'hook table has no Status column' });
    }
    index += 2;
    while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
      const line = index + 1;
      const row = readRow(cells(lines[index] ?? ''), line, header, (rule, message) => {
        problems.push({ rule, file: mapFile, line, message });
      });
      if (row !== undefined) {
        rows.push(row);
      }
      index++;
    }
  }
  return { rows, tables };
}

function checkCodeRow(
  row: Row,
  refs: readonly Reference[],
  source: Source,
  mapFile: string,
  problems: Problem[],
): void {
  const calls = source.calls.filter((call) => call.name === row.name);
  const anchorFiles = new Set(refs.map((ref) => ref.path));
  for (const call of calls.filter((each) => !anchorFiles.has(each.file))) {
    problems.push({
      rule: 'R10',
      file: call.file,
      line: call.line,
      message: `${row.name} is called outside its anchor files`,
    });
  }
  if (row.status === 'planned') {
    for (const call of calls) {
      problems.push({
        rule: 'R9',
        file: call.file,
        line: call.line,
        message: `${row.name} is planned (map line ${row.line}) but called`,
      });
    }
    return;
  }
  for (const ref of refs) {
    const file = source.files.get(ref.path);
    const missing =
      file === undefined
        ? [`no file ${ref.path}`]
        : [ref.ident, ref.qualifier]
            .filter((ident) => ident !== undefined && !file.declared.has(ident))
            .map((ident) => `${ref.path} declares no ${ident}`);
    for (const message of missing) {
      problems.push({ rule: 'R6', file: mapFile, line: row.line, message: `${row.name}: ${message}` });
    }
  }
  if (!calls.some((call) => anchorFiles.has(call.file))) {
    problems.push({
      rule: 'R8',
      file: mapFile,
      line: row.line,
      message: `${row.name} is built but not called in ${[...anchorFiles].join(', ')}`,
    });
  }
}

function checkRecorderRow(
  row: Row,
  derived: readonly string[],
  context: { source: Source; emitted: ReadonlySet<string>; names: ReadonlySet<string> },
  mapFile: string,
  problems: Problem[],
): void {
  for (const call of context.source.calls.filter((each) => each.name === row.name && !each.file.startsWith('diag/'))) {
    problems.push({
      rule: 'R10',
      file: call.file,
      line: call.line,
      message: `${row.name} is a recorder or derived row but called from engine code`,
    });
  }
  const emitted = context.emitted.has(row.name);
  if (row.status === 'planned' && emitted) {
    problems.push({
      rule: 'R9',
      file: mapFile,
      line: row.line,
      message: `${row.name} is planned but the recorder emits it`,
    });
  }
  if (row.status !== 'built') {
    return;
  }
  if (!emitted) {
    problems.push({
      rule: 'R8',
      file: mapFile,
      line: row.line,
      message: `${row.name} is built but the recorder under diag/ emits no such name`,
    });
  }
  for (const hook of derived.filter((each) => !context.names.has(each))) {
    problems.push({
      rule: 'R7',
      file: mapFile,
      line: row.line,
      message: `${row.name} derives from ${hook}, which has no row`,
    });
  }
}

function checkRows(map: MapRead, source: Source, mapFile: string, problems: Problem[]): void {
  const firstLine = new Map<string, number>();
  for (const row of map.rows) {
    const first = firstLine.get(row.name);
    if (first === undefined) {
      firstLine.set(row.name, row.line);
    } else {
      problems.push({
        rule: 'R3',
        file: mapFile,
        line: row.line,
        message: `${row.name} already has a row at map line ${first}`,
      });
    }
  }
  const emitted = recorderNames(source.files);
  const names = new Set(firstLine.keys());
  for (const row of map.rows) {
    if (row.anchor?.kind === 'code' && row.status !== undefined) {
      checkCodeRow(row, row.anchor.refs, source, mapFile, problems);
    } else if (row.anchor !== undefined && row.status !== undefined) {
      checkRecorderRow(
        row,
        row.anchor.kind === 'derived' ? row.anchor.hooks : [],
        { source, emitted, names },
        mapFile,
        problems,
      );
    }
  }
  for (const call of source.calls) {
    if (!hookPattern.test(call.name)) {
      problems.push({
        rule: 'R2',
        file: call.file,
        line: call.line,
        message: `called name "${call.name}" breaks the hook-name pattern`,
      });
    } else if (!names.has(call.name)) {
      problems.push({ rule: 'R4', file: call.file, line: call.line, message: `${call.name} is called but has no row` });
    }
  }
  for (const call of source.dynamic) {
    problems.push({ rule: 'R5', file: call.file, line: call.line, message: call.name });
  }
}

function printProblems(problems: readonly Problem[], mapFile: string, src: string): void {
  const order = Object.keys(ruleTitles);
  const sorted = [...problems].sort(
    (a, b) => order.indexOf(a.rule) - order.indexOf(b.rule) || a.file.localeCompare(b.file) || a.line - b.line,
  );
  let rule = '';
  for (const problem of sorted) {
    if (problem.rule !== rule) {
      rule = problem.rule;
      process.stderr.write(`${rule} ${ruleTitles[rule] ?? ''}\n`);
    }
    const where =
      problem.file === mapFile
        ? `map line ${problem.line}`
        : `${relative(process.cwd(), join(src, problem.file))}:${problem.line}`;
    process.stderr.write(`  ${where}  ${problem.message}\n`);
  }
}

function notRun(reason: string): number {
  process.stderr.write(`Map check could not run: ${reason}\n`);
  return 3;
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
  let text: string;
  try {
    text = readFileSync(options.map, 'utf8');
  } catch (error) {
    return notRun(`cannot read the map: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!statSync(options.src, { throwIfNoEntry: false })?.isDirectory()) {
    return notRun(`${options.src} is not a directory`);
  }
  const tokenizer = await loadTokenizer();
  if (typeof tokenizer === 'string') {
    return notRun(`the TypeScript scanner will not load: ${tokenizer}`);
  }
  const mapFile = relative(process.cwd(), options.map);
  const problems: Problem[] = [];
  const map = readMap(text, mapFile, problems);
  if (map.tables === 0) {
    return notRun(`${mapFile} has no hook table`);
  }
  checkRows(map, readSource(options.src, tokenizer), mapFile, problems);
  if (problems.length > 0) {
    printProblems(problems, mapFile, options.src);
    process.stderr.write(`Map check failed: ${problems.length} problem(s).\n`);
    return 1;
  }
  const built = map.rows.filter((row) => row.status === 'built').length;
  process.stdout.write(
    `ok map: ${mapFile}, ${map.tables} hook tables, ${map.rows.length} rows: ${built} built, ${map.rows.length - built} planned\n`,
  );
  process.stdout.write('Map check passed.\n');
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
