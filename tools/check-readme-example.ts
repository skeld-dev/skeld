import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Fence {
  readonly lang: string;
  readonly lines: readonly string[];
}

interface Expected {
  readonly name: string;
  readonly lang: string;
  readonly text: string;
}

const root = resolve(import.meta.dirname, '..');
const readmePath = 'packages/core/README.md';

const expected: readonly Expected[] = [
  ...['contract.ts', 'hello.ts', 'client.ts'].map((file) => {
    const name = `examples/hello/${file}`;
    return { name, lang: 'ts', text: readFileSync(join(root, name), 'utf8') };
  }),
  { name: `${readmePath} sh block`, lang: 'sh', text: 'node hello.ts\nnode client.ts\n' },
  { name: `${readmePath} text block`, lang: 'text', text: 'Hello, Ada!\nOlá, Ada\n' },
];

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function exampleFences(readme: string): Fence[] {
  const lines = readme.split('\n');
  const start = lines.indexOf('## Example');
  if (start === -1) {
    fail(`${readmePath}: no "## Example" section`);
  }
  const fences: Fence[] = [];
  let open: { lang: string; lines: string[] } | null = null;
  for (const line of lines.slice(start + 1)) {
    if (open === null) {
      if (line.startsWith('## ') || line.startsWith('# ')) {
        break;
      }
      if (line.startsWith('```')) {
        open = { lang: line.slice(3), lines: [] };
      }
    } else if (line === '```') {
      fences.push(open);
      open = null;
    } else {
      open.lines.push(line);
    }
  }
  if (open !== null) {
    fail(`${readmePath}: unclosed fence in the Example section`);
  }
  return fences;
}

const fences = exampleFences(readFileSync(join(root, readmePath), 'utf8'));
if (fences.length !== expected.length) {
  fail(`${readmePath}: Example section has ${fences.length} fences, expected ${expected.length}`);
}

expected.forEach((block, index) => {
  const fence = fences[index];
  if (fence === undefined || fence.lang !== block.lang) {
    fail(`${block.name}: README block ${index + 1} is not a \`\`\`${block.lang} fence`);
  }
  const shown = `${fence.lines.join('\n')}\n`.split('\n');
  const source = block.text.split('\n');
  const length = Math.max(shown.length, source.length);
  for (let line = 0; line < length; line++) {
    if (shown[line] !== source[line]) {
      fail(`${block.name}: README block differs at line ${line + 1}`);
    }
  }
  process.stdout.write(`ok ${block.name}\n`);
});
