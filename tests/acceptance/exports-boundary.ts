// Does:  Proves that only the paths listed in the package's exports map can be imported.
// Holds: An unlisted path and the bare package name both fail with ERR_PACKAGE_PATH_NOT_EXPORTED.

import { existsSync } from 'node:fs';
import { check, conclude } from './support.ts';

const statement =
  'an import of a path the package does not list in exports, or of the bare package name, fails in Node with ERR_PACKAGE_PATH_NOT_EXPORTED';
const expectedCode = 'ERR_PACKAGE_PATH_NOT_EXPORTED';

const unexportedFile = ['@darkstart', 'core', 'dist', 'router', 'tree.js'].join('/');
const barePackage = ['@darkstart', 'core'].join('/');
const exportedSubpath = ['@darkstart', 'core', 'contract'].join('/');

async function rejection(specifier: string): Promise<unknown> {
  try {
    await import(specifier);
  } catch (error) {
    return error;
  }
  return undefined;
}

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : error;
}

const problems: string[] = [];
const packageJson = import.meta.resolve('@darkstart/core/package.json');
const treeFile = new URL('./dist/router/tree.js', packageJson);
check(problems, existsSync(treeFile), `${treeFile.pathname} does not exist, so the rejection would prove nothing`);

const refused = [unexportedFile, barePackage];
const errors = await Promise.all(refused.map((specifier) => rejection(specifier)));
for (const [index, error] of errors.entries()) {
  check(problems, codeOf(error) === expectedCode, `import of ${refused[index]} gave ${String(codeOf(error))}`);
}
const control = await rejection(exportedSubpath);
check(
  problems,
  control === undefined,
  `import of the exported ${exportedSubpath} rejected with ${String(codeOf(control))}`,
);
conclude(statement, problems);
