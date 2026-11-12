// Does:  Walks a package's exports map with the compiler and lists every public symbol with its doc block.
// Holds: A symbol is public only if a subpath of the exports map reaches it; nothing is found by folder or by name.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Node, SourceFile } from 'typescript/unstable/ast';
import type { API, Checker, Project, Symbol as CompilerSymbol, Type } from 'typescript/unstable/sync';

type Sync = typeof import('typescript/unstable/sync');
type Ast = typeof import('typescript/unstable/ast');

interface Compiler {
  readonly sync: Sync;
  readonly ast: Ast;
}

interface Reader {
  readonly compiler: Compiler;
  readonly project: Project;
  readonly checker: Checker;
  readonly source: SourceFile;
}

interface PackageEntry {
  readonly subpath: string;
  readonly file: string;
  readonly config: string;
}

interface Manifest {
  readonly name: string;
  readonly entries: readonly PackageEntry[];
}

interface Shape {
  readonly declaration: string;
  readonly fields: readonly PublicSymbol[];
}

type Range = readonly [number, number];

export interface Refusal {
  readonly refused: string;
}

export type SymbolKind = 'function' | 'class' | 'variable' | 'interface' | 'type' | 'enum' | 'field';

export interface Block {
  readonly lines: readonly string[];
  readonly summary: string;
  readonly rules: string;
  readonly tags: readonly string[];
  readonly example: string | undefined;
  readonly see: string | undefined;
}

export interface PublicSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly file: string;
  readonly line: number;
  readonly block: Block | undefined;
  readonly documentation: string;
  readonly callable: boolean;
  readonly declaration: string;
  readonly fields: readonly PublicSymbol[];
}

export interface Entry {
  readonly subpath: string;
  readonly file: string;
  readonly symbols: readonly PublicSymbol[];
  readonly values: readonly string[];
}

export interface Walk {
  readonly packageName: string;
  readonly packageFolder: string;
  readonly entries: readonly Entry[];
  readonly extra: Entry | undefined;
}

export interface WalkRequest {
  readonly packageDir: string;
  readonly extra?: { readonly file: string; readonly config: string };
}

export const root = resolve(import.meta.dirname, '../..');
export const namespaceSubpath = './schema';
const namespaceName = 't';

export function display(file: string): string {
  const path = relative(root, file);
  return path.startsWith('..') || isAbsolute(path) ? file : path;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadCompiler(): Promise<Compiler | Refusal> {
  try {
    const [sync, ast] = await Promise.all([import('typescript/unstable/sync'), import('typescript/unstable/ast')]);
    return { sync, ast };
  } catch (error) {
    return { refused: `the compiler API will not load: ${message(error)}` };
  }
}

function owningConfig(file: string): string | undefined {
  let dir = dirname(file);
  while (true) {
    const config = join(dir, 'tsconfig.json');
    if (existsSync(config)) {
      return config;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function readPackage(packageDir: string): Manifest | Refusal {
  const manifestPath = join(packageDir, 'package.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { refused: `cannot read ${display(manifestPath)}: ${message(error)}` };
  }
  if (!isRecord(manifest) || typeof manifest.name !== 'string') {
    return { refused: `${display(manifestPath)} has no name` };
  }
  if (!isRecord(manifest.exports)) {
    return { refused: `${display(manifestPath)} has no exports map` };
  }
  const entries: PackageEntry[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (!isRecord(target) || !('default' in target)) {
      continue;
    }
    const source = target['skeld-source'];
    if (typeof source !== 'string') {
      return { refused: `export ${subpath} of ${display(manifestPath)} has no skeld-source file` };
    }
    const file = resolve(packageDir, source);
    const config = owningConfig(file);
    if (config === undefined) {
      return { refused: `no tsconfig.json above ${display(file)}` };
    }
    entries.push({ subpath, file, config });
  }
  return { name: manifest.name, entries };
}

function lineOf(reader: Reader, node: Node): number {
  return reader.source.getLineAndCharacterOfPosition(node.getStart(reader.source)).line + 1;
}

function documentedNode(reader: Reader, node: Node): Node {
  const { ast } = reader.compiler;
  if (ast.isVariableDeclaration(node) && ast.isVariableDeclarationList(node.parent)) {
    const statement = node.parent.parent;
    if (ast.isVariableStatement(statement)) {
      return statement;
    }
  }
  return node;
}

function blockStart(reader: Reader, doc: Node | undefined): number | undefined {
  if (doc === undefined) {
    return undefined;
  }
  const start = reader.source.text.indexOf('/**', doc.pos);
  return start === -1 || start >= doc.end ? undefined : start;
}

function contentLines(text: string): string[] {
  const lines = text
    .slice(3, -2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : line.replace(/^\s*\*?/, '')).trim());
  if (lines[0] === '') {
    lines.shift();
  }
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function tagLine(lines: readonly string[], tag: string): string | undefined {
  const pattern = new RegExp(`^@${tag}(?:\\s+(.*))?$`);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match !== null) {
      return match[1] ?? '';
    }
  }
  return undefined;
}

function readBlock(reader: Reader, node: Node): Block | undefined {
  const { ast } = reader.compiler;
  const doc = node.jsDoc?.at(-1);
  const start = blockStart(reader, doc);
  if (doc === undefined || start === undefined || !ast.isJSDoc(doc)) {
    return undefined;
  }
  const lines = contentLines(reader.source.text.slice(start, doc.end));
  const first = lines[0] ?? '';
  return {
    lines,
    summary: first.startsWith('@') ? '' : first,
    rules: lines
      .slice(1)
      .filter((line) => line !== '' && !line.startsWith('@'))
      .join(' '),
    tags: (doc.tags ?? []).map((tag) => tag.tagName.text),
    example: tagLine(lines, 'example'),
    see: tagLine(lines, 'see'),
  };
}

function propertyName(reader: Reader, name: Node): string {
  const { ast } = reader.compiler;
  if (
    ast.isIdentifier(name) ||
    ast.isStringLiteral(name) ||
    ast.isNumericLiteral(name) ||
    ast.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return name.getText(reader.source);
}

function docCuts(reader: Reader, nodes: readonly Node[]): Range[] {
  return nodes.flatMap((node): Range[] => {
    const start = blockStart(reader, node.jsDoc?.[0]);
    return start === undefined ? [] : [[start, node.getStart(reader.source)]];
  });
}

function sliceWithout(reader: Reader, start: number, end: number, cuts: readonly Range[]): string {
  let text = '';
  let at = start;
  for (const [cutStart, cutEnd] of [...cuts].sort((a, b) => a[0] - b[0])) {
    if (cutStart >= at && cutEnd <= end) {
      text += reader.source.text.slice(at, cutStart);
      at = cutEnd;
    }
  }
  return (text + reader.source.text.slice(at, end)).trim();
}

function printType(reader: Reader, type: Type, enclosing: Node): string | undefined {
  const typeNode = reader.checker.typeToTypeNode(type, enclosing, reader.compiler.sync.NodeBuilderFlags.NoTruncation);
  return typeNode === undefined ? undefined : reader.project.emitter.printNode(typeNode);
}

function isCallable(reader: Reader, type: Type | undefined): boolean {
  return (
    type !== undefined && reader.checker.getSignaturesOfType(type, reader.compiler.sync.SignatureKind.Call).length > 0
  );
}

function typeLiterals(reader: Reader, node: Node): Node[] {
  const { ast } = reader.compiler;
  if (ast.isParenthesizedTypeNode(node)) {
    return typeLiterals(reader, node.type);
  }
  if (ast.isUnionTypeNode(node) || ast.isIntersectionTypeNode(node)) {
    return node.types.flatMap((member) => typeLiterals(reader, member));
  }
  return ast.isTypeLiteralNode(node) ? [node] : [];
}

function fieldDeclarations(reader: Reader, declaration: Node): Node[] {
  const { ast } = reader.compiler;
  const containers = ast.isInterfaceDeclaration(declaration)
    ? [declaration]
    : ast.isTypeAliasDeclaration(declaration)
      ? typeLiterals(reader, declaration.type)
      : [];
  return containers.flatMap((container) =>
    ast.isInterfaceDeclaration(container) || ast.isTypeLiteralNode(container)
      ? container.members.filter(
          (member) => ast.isPropertySignatureDeclaration(member) || ast.isMethodSignatureDeclaration(member),
        )
      : [],
  );
}

function fieldSymbol(reader: Reader, declaredType: Type, name: string, cited: Node): CompilerSymbol | undefined {
  const { ast } = reader.compiler;
  const property = reader.checker.getPropertyOfType(declaredType, name);
  if (property !== undefined) {
    return property;
  }
  return ast.isPropertySignatureDeclaration(cited) || ast.isMethodSignatureDeclaration(cited)
    ? reader.checker.getSymbolAtLocation(cited.name)
    : undefined;
}

function readFields(reader: Reader, owner: string, target: CompilerSymbol, declaration: Node): PublicSymbol[] {
  const { ast } = reader.compiler;
  const declaredType = reader.checker.getDeclaredTypeOfSymbol(target);
  const groups = new Map<string, Node[]>();
  for (const member of fieldDeclarations(reader, declaration)) {
    if (ast.isPropertySignatureDeclaration(member) || ast.isMethodSignatureDeclaration(member)) {
      const name = propertyName(reader, member.name);
      groups.set(name, [...(groups.get(name) ?? []), member]);
    }
  }
  const fields: PublicSymbol[] = [];
  for (const [name, declarations] of groups) {
    const cited = declarations.find((member) => readBlock(reader, member) !== undefined) ?? declarations[0];
    if (cited === undefined) {
      continue;
    }
    const symbol = fieldSymbol(reader, declaredType, name, cited);
    fields.push({
      name: `${owner}.${name}`,
      kind: 'field',
      file: display(reader.source.fileName),
      line: lineOf(reader, cited),
      block: readBlock(reader, cited),
      documentation: symbol === undefined ? '' : reader.checker.getDocumentationCommentOfSymbol(symbol),
      callable: false,
      declaration: cited.getText(reader.source),
      fields: [],
    });
  }
  return fields;
}

function functionDeclaration(reader: Reader, target: CompilerSymbol, declaration: Node): string {
  const { ast } = reader.compiler;
  const overloads = target.declarations.flatMap((handle) => {
    const node = handle.resolve(reader.project);
    return node !== undefined && ast.isFunctionDeclaration(node) && node.body === undefined ? [node] : [];
  });
  if (overloads.length > 0) {
    return overloads.map((node) => node.getText(reader.source)).join('\n');
  }
  const end = ast.isFunctionDeclaration(declaration) ? (declaration.body?.pos ?? declaration.end) : declaration.end;
  return reader.source.text.slice(declaration.getStart(reader.source), end).trim();
}

function classDeclaration(reader: Reader, node: Node): string {
  const { ast, sync } = reader.compiler;
  if (!ast.isClassDeclaration(node)) {
    return node.getText(reader.source);
  }
  const hidden = sync.ModifierFlags.Private | sync.ModifierFlags.Protected;
  const lines = [reader.source.text.slice(node.getStart(reader.source), node.members.pos).trim()];
  for (const member of node.members) {
    let end = member.end;
    if (ast.isConstructorDeclaration(member)) {
      if ((member.modifierFlags & hidden) !== 0) {
        continue;
      }
      end = member.body?.pos ?? member.end;
    } else if (
      ast.isMethodDeclaration(member) ||
      ast.isGetAccessorDeclaration(member) ||
      ast.isSetAccessorDeclaration(member)
    ) {
      if ((member.modifierFlags & hidden) !== 0 || ast.isPrivateIdentifier(member.name)) {
        continue;
      }
      end = member.body?.pos ?? member.end;
    } else if (
      !ast.isPropertyDeclaration(member) ||
      (member.modifierFlags & hidden) !== 0 ||
      ast.isPrivateIdentifier(member.name)
    ) {
      continue;
    }
    const text = reader.source.text.slice(member.getStart(reader.source), end).trim();
    lines.push(`  ${text.endsWith(';') ? text : `${text};`}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function variableShape(
  reader: Reader,
  name: string,
  target: CompilerSymbol,
  declaration: Node,
  documented: Node,
): Shape | Refusal {
  const { ast } = reader.compiler;
  if (!ast.isVariableDeclaration(declaration)) {
    return { refused: `export ${name} is a variable without a declaration` };
  }
  const type = reader.checker.getTypeOfSymbol(target);
  const printed = type === undefined ? undefined : printType(reader, type, declaration);
  if (printed === undefined) {
    return { refused: `export ${name} has a type the compiler will not print` };
  }
  const header = reader.source.text.slice(documented.getStart(reader.source), declaration.name.end).trim();
  return { declaration: `${header}: ${printed}`, fields: [] };
}

function exportShape(
  reader: Reader,
  name: string,
  kind: SymbolKind,
  target: CompilerSymbol,
  declaration: Node,
): Shape | Refusal {
  const documented = documentedNode(reader, declaration);
  const start = documented.getStart(reader.source);
  if (kind === 'variable') {
    return variableShape(reader, name, target, declaration, documented);
  }
  if (kind === 'class') {
    return { declaration: classDeclaration(reader, declaration), fields: [] };
  }
  if (kind === 'function') {
    return { declaration: functionDeclaration(reader, target, declaration), fields: [] };
  }
  const cuts = docCuts(reader, fieldDeclarations(reader, declaration));
  return {
    declaration: sliceWithout(reader, start, documented.end, cuts),
    fields: readFields(reader, name, target, declaration),
  };
}

function symbolKind(reader: Reader, target: CompilerSymbol): SymbolKind | undefined {
  const flags = reader.compiler.sync.SymbolFlags;
  const kinds: readonly [number, SymbolKind][] = [
    [flags.Function, 'function'],
    [flags.Class, 'class'],
    [flags.Variable, 'variable'],
    [flags.Interface, 'interface'],
    [flags.TypeAlias, 'type'],
    [flags.Enum, 'enum'],
  ];
  return kinds.find(([flag]) => (target.flags & flag) !== 0)?.[1];
}

function isTypeOnlyExport(reader: Reader, site: Node | undefined): boolean {
  const { ast } = reader.compiler;
  if (site === undefined || !ast.isExportSpecifier(site)) {
    return false;
  }
  const declaration = site.parent.parent;
  return site.isTypeOnly || (ast.isExportDeclaration(declaration) && declaration.isTypeOnly);
}

function aliasTarget(reader: Reader, symbol: CompilerSymbol): CompilerSymbol {
  return symbol.flags & reader.compiler.sync.SymbolFlags.Alias ? reader.checker.getAliasedSymbol(symbol) : symbol;
}

function readExport(reader: Reader, exported: CompilerSymbol, typeOnly: boolean, name: string): PublicSymbol | Refusal {
  const target = aliasTarget(reader, exported);
  if (reader.checker.isUnknownSymbol(target)) {
    return { refused: `export ${exported.name} does not resolve` };
  }
  const declaration = (target.valueDeclaration ?? target.declarations[0])?.resolve(reader.project);
  const kind = symbolKind(reader, target);
  if (declaration === undefined || kind === undefined) {
    return { refused: `export ${exported.name} is not a function, class, variable, interface, type or enum` };
  }
  const declared: Reader = { ...reader, source: declaration.getSourceFile() };
  const shape = exportShape(declared, exported.name, kind, target, declaration);
  if ('refused' in shape) {
    return shape;
  }
  const documented = documentedNode(declared, declaration);
  const callable =
    !typeOnly &&
    (kind === 'function' || kind === 'variable') &&
    isCallable(declared, reader.checker.getTypeOfSymbol(target));
  return {
    name,
    kind,
    file: display(declared.source.fileName),
    line: lineOf(declared, documented),
    block: readBlock(declared, documented),
    documentation: reader.checker.getDocumentationCommentOfSymbol(target),
    callable,
    ...shape,
  };
}

function readEntry(compiler: Compiler, project: Project, subpath: string, file: string): Entry | Refusal {
  const source = project.program.getSourceFile(file);
  if (source === undefined) {
    return { refused: `${display(file)} is not in ${display(project.configFileName)}` };
  }
  const reader: Reader = { compiler, project, checker: project.checker, source };
  const moduleSymbol = project.checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) {
    return { refused: `${display(file)} is not a module` };
  }
  const inEntry = (node: Node | undefined): number | undefined =>
    node !== undefined && node.getSourceFile().fileName === source.fileName ? node.pos : undefined;
  const exported = project.checker.getExportsOfModule(moduleSymbol).map((symbol) => {
    const site = symbol.declarations[0]?.resolve(project);
    const target = aliasTarget(reader, symbol);
    const defined = (target.valueDeclaration ?? target.declarations[0])?.resolve(project);
    return { symbol, site, order: inEntry(defined) ?? inEntry(site) ?? Number.MAX_SAFE_INTEGER };
  });
  exported.sort((a, b) => a.order - b.order || a.symbol.name.localeCompare(b.symbol.name));
  const prefix = subpath === namespaceSubpath ? `${namespaceName}.` : '';
  const symbols: PublicSymbol[] = [];
  const values: string[] = [];
  for (const { symbol, site } of exported) {
    const typeOnly = isTypeOnlyExport(reader, site);
    const value = !typeOnly && (aliasTarget(reader, symbol).flags & compiler.sync.SymbolFlags.Value) !== 0;
    const read = readExport(reader, symbol, typeOnly, value ? `${prefix}${symbol.name}` : symbol.name);
    if ('refused' in read) {
      return { refused: `${display(file)}: ${read.refused}` };
    }
    symbols.push(read);
    if (value) {
      values.push(symbol.name);
    }
  }
  return { subpath, file: display(file), symbols, values };
}

function readProjects(compiler: Compiler, api: API, manifest: Manifest, request: WalkRequest): Walk | Refusal {
  const configs = [
    ...new Set([...manifest.entries.map((entry) => entry.config), ...(request.extra ? [request.extra.config] : [])]),
  ];
  const snapshot = api.updateSnapshot({ openProjects: configs });
  const read = (config: string, subpath: string, file: string): Entry | Refusal => {
    const project = snapshot.getProject(config);
    return project === undefined
      ? { refused: `the compiler did not open ${display(config)}` }
      : readEntry(compiler, project, subpath, file);
  };
  const entries: Entry[] = [];
  for (const entry of manifest.entries) {
    const result = read(entry.config, entry.subpath, entry.file);
    if ('refused' in result) {
      return result;
    }
    entries.push(result);
  }
  let extra: Entry | undefined;
  if (request.extra !== undefined) {
    const result = read(request.extra.config, display(request.extra.file), request.extra.file);
    if ('refused' in result) {
      return result;
    }
    extra = result;
  }
  return { packageName: manifest.name, packageFolder: basename(resolve(request.packageDir)), entries, extra };
}

export async function walk(request: WalkRequest): Promise<Walk | Refusal> {
  const compiler = await loadCompiler();
  if ('refused' in compiler) {
    return compiler;
  }
  const manifest = readPackage(request.packageDir);
  if ('refused' in manifest) {
    return manifest;
  }
  let api: API | undefined;
  try {
    api = new compiler.sync.API({ cwd: root });
    return readProjects(compiler, api, manifest, request);
  } catch (error) {
    return { refused: `the compiler failed: ${message(error)}` };
  } finally {
    api?.close();
  }
}
