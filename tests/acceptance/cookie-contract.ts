// Does:  Proves a route's declared cookies arrive typed and validated, and a secret cookie value leaks nowhere.
// Holds: A declared cookie is checked like a header; bad cases are 400 and planted values are searched for everywhere.

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude, type RawResponse, rawExchange } from './support.ts';
import { compileProbes } from './support-compile.ts';
import { startDiagChild } from './support-diag.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'a declared cookie arrives typed and validated; a missing required cookie, a wrong value, a wrong-case name and a name sent twice are each 400; undeclared cookies, also __proto__ and constructor, are ignored; a secret cookie value is in no error body, stderr line or diag file; an invalid cookie name in the contract is refused at boot; request.cookies is typed from the schema and the client call type accepts no cookie';

const noteBody = t.object({ ok: t.boolean() });
const profileSchema = t.object({
  theme: t.string({ maxLength: 16 }),
  visits: t.integer({ minimum: 0, maximum: 1000 }),
  sid: t.string({ maxLength: 64, sensitivity: 'secret' }),
  lang: t.optional(t.string({ maxLength: 8 })),
});
const contract = defineContract({
  profile: {
    method: 'GET',
    path: '/profile',
    cookies: profileSchema,
    responses: {
      200: t.object({
        theme: t.string({ maxLength: 16 }),
        visits: t.integer(),
        hasSid: t.boolean(),
        keys: t.string({ maxLength: 200 }),
      }),
    },
  },
  explode: { method: 'GET', path: '/explode', cookies: profileSchema, responses: { 200: noteBody } },
  plain: { method: 'GET', path: '/plain', responses: { 200: t.object({ keys: t.string({ maxLength: 200 }) }) } },
});

async function serve(): Promise<void> {
  const server = createServer();
  server.routes(contract, {
    profile: ({ cookies }) => ({
      status: 200,
      body: {
        theme: cookies.theme,
        visits: cookies.visits,
        hasSid: cookies.sid !== undefined,
        keys: Object.keys(cookies).sort().join(','),
      },
    }),
    explode: ({ cookies }) => {
      throw new Error(`could not process ${String(cookies.sid)}`);
    },
    plain: ({ cookies }) => ({ status: 200, body: { keys: Object.keys(cookies).join(',') } }),
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.on('SIGTERM', () => {
    void server.close().then(() => process.exit(0));
  });
  process.stdout.write(`listening ${port}\n`);
}

function get(path: string, lines: readonly string[]): string {
  return `GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n${lines.map((line) => `${line}\r\n`).join('')}\r\n`;
}

const secret = randomBytes(8).toString('hex');
const longSecret = randomBytes(40).toString('hex');
const valid = `theme=dark; visits=7; sid=${secret}`;

interface Row {
  label: string;
  lines: readonly string[];
  status: number;
}
const rows: Row[] = [
  { label: 'all declared', lines: [`Cookie: ${valid}; lang=en`], status: 200 },
  { label: 'optional absent', lines: [`Cookie: ${valid}`], status: 200 },
  {
    label: 'undeclared and proto names',
    lines: [`Cookie: ${valid}; junk=1; __proto__=evil; constructor=x; toString=y`],
    status: 200,
  },
  { label: 'undeclared sent twice', lines: [`Cookie: ${valid}; junk=1; junk=2`], status: 200 },
  { label: 'two Cookie lines', lines: [`Cookie: theme=dark; sid=${secret}`, 'Cookie: visits=3'], status: 200 },
  { label: 'required theme missing', lines: [`Cookie: visits=7; sid=${secret}`], status: 400 },
  { label: 'required sid missing', lines: ['Cookie: theme=dark; visits=7'], status: 400 },
  { label: 'no Cookie header', lines: [], status: 400 },
  { label: 'visits not a number', lines: [`Cookie: theme=dark; visits=abc; sid=${secret}`], status: 400 },
  { label: 'visits over maximum', lines: [`Cookie: theme=dark; visits=1001; sid=${secret}`], status: 400 },
  { label: 'theme too long', lines: [`Cookie: theme=${'x'.repeat(17)}; visits=7; sid=${secret}`], status: 400 },
  { label: 'wrong-case name', lines: [`Cookie: Theme=dark; visits=7; sid=${secret}`], status: 400 },
  { label: 'theme sent twice', lines: [`Cookie: theme=dark; theme=light; visits=7; sid=${secret}`], status: 400 },
  {
    label: 'theme twice across lines',
    lines: ['Cookie: theme=dark; visits=7', `Cookie: theme=dark; sid=${secret}`],
    status: 400,
  },
  { label: 'secret sent twice', lines: [`Cookie: theme=dark; visits=7; sid=${secret}; sid=${secret}`], status: 400 },
  { label: 'secret too long', lines: [`Cookie: theme=dark; visits=7; sid=${longSecret}`], status: 400 },
  { label: 'secret with another part wrong', lines: [`Cookie: theme=dark; visits=abc; sid=${secret}`], status: 400 },
];

function parsedBody(response: RawResponse): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(response.body);
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  } catch {
    return {};
  }
}

async function exercise(problems: string[], port: number, tag: string): Promise<number> {
  let sent = 0;
  for (const row of rows) {
    // biome-ignore lint/performance/noAwaitInLoops: Serial requests keep each row's wire bytes apart.
    const response = await rawExchange(port, get('/profile', row.lines));
    sent++;
    const label = `${tag} ${row.label}`;
    check(problems, response.status === row.status, `${label}: status ${response.status}, expected ${row.status}`);
    const body = parsedBody(response);
    if (row.status === 200) {
      check(problems, body.theme === 'dark', `${label}: theme ${JSON.stringify(body.theme)}`);
      check(
        problems,
        body.visits === (row.label === 'two Cookie lines' ? 3 : 7),
        `${label}: visits ${JSON.stringify(body.visits)}`,
      );
      check(problems, body.hasSid === true, `${label}: sid missing in the handler`);
      const expectedKeys = row.label === 'all declared' ? 'lang,sid,theme,visits' : 'sid,theme,visits';
      check(
        problems,
        body.keys === expectedKeys,
        `${label}: handler saw cookies ${JSON.stringify(body.keys)}, expected ${expectedKeys}`,
      );
    } else {
      check(problems, body.code === 'VALIDATION', `${label}: code ${JSON.stringify(body.code)}`);
      check(problems, body.status === 400, `${label}: body status ${JSON.stringify(body.status)}`);
      check(problems, Array.isArray(body.details) && body.details.length > 0, `${label}: no details in the 400`);
    }
    check(
      problems,
      !response.raw.includes(secret) && !response.raw.includes(longSecret),
      `${label}: the secret value is on the wire`,
    );
  }
  const detail = await rawExchange(port, get('/profile', ['Cookie: theme=dark; visits=abc; sid=x']));
  check(problems, detail.body.includes('visits'), `${tag} the 400 for visits does not name visits: ${detail.body}`);
  const plain = await rawExchange(port, get('/plain', [`Cookie: ${valid}; junk=1`]));
  check(
    problems,
    plain.status === 200 && parsedBody(plain).keys === '',
    `${tag} a route declaring none saw cookies ${plain.body}`,
  );
  const blown = await rawExchange(port, get('/explode', [`Cookie: ${valid}`]));
  check(problems, blown.status === 500, `${tag} /explode answered ${blown.status}`);
  check(
    problems,
    blown.body === '{"status":500,"code":"INTERNAL","message":"Internal Server Error"}',
    `${tag} 500 body ${blown.body}`,
  );
  check(problems, !blown.raw.includes(secret), `${tag} the secret value is in the 500 response`);
  return sent;
}

async function tryBoot(name: string): Promise<string> {
  try {
    const declared = defineContract({
      probe: {
        method: 'GET',
        path: '/probe',
        cookies: t.object({ [name]: t.string({ maxLength: 8 }) }),
        responses: { 200: noteBody },
      },
    });
    const server = createServer();
    server.routes(declared, { probe: () => ({ status: 200, body: { ok: true } }) });
    const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
    await server.close();
    return `accepted on ${port > 0 ? 'listen' : '?'}`;
  } catch (error) {
    return `refused ${error instanceof Error ? error.name : 'unknown'}`;
  }
}

const probes = {
  typed: `import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { expose } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
const contract = defineContract({
  item: {
    method: 'GET',
    path: '/item',
    cookies: t.object({ theme: t.string({ maxLength: 16 }), visits: t.integer(), sid: t.string({ maxLength: 8, sensitivity: 'secret' }), lang: t.optional(t.string({ maxLength: 8 })) }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
});
const client = createClient(contract, { baseUrl: 'http://127.0.0.1:1' });
const server = createServer();
server.routes(contract, {
  item: (request) => {
    const theme: string = request.cookies.theme;
    const visits: number = request.cookies.visits;
    const sid: string = expose(request.cookies.sid);
    const lang: string | undefined = request.cookies.lang;
    return { status: 200, body: { ok: theme.length + visits + sid.length + (lang?.length ?? 0) > 0 } };
  },
});
await client.item();
`,
  visitsAsString: `import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
const contract = defineContract({ item: { method: 'GET', path: '/item', cookies: t.object({ visits: t.integer() }), responses: { 200: t.object({ ok: t.boolean() }) } } });
const server = createServer();
server.routes(contract, { item: (request) => { const visits: string = request.cookies.visits; return { status: 200, body: { ok: visits.length > 0 } }; } }); // BAD
`,
  undeclaredName: `import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
const contract = defineContract({ item: { method: 'GET', path: '/item', cookies: t.object({ theme: t.string({ maxLength: 8 }) }), responses: { 200: t.object({ ok: t.boolean() }) } } });
const server = createServer();
server.routes(contract, { item: (request) => ({ status: 200, body: { ok: request.cookies.other === undefined } }) }); // BAD
`,
  optionalUnchecked: `import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
const contract = defineContract({ item: { method: 'GET', path: '/item', cookies: t.object({ lang: t.optional(t.string({ maxLength: 8 })) }), responses: { 200: t.object({ ok: t.boolean() }) } } });
const server = createServer();
server.routes(contract, { item: (request) => ({ status: 200, body: { ok: request.cookies.lang.length > 0 } }) }); // BAD
`,
  secretAsString: `import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
const contract = defineContract({ item: { method: 'GET', path: '/item', cookies: t.object({ sid: t.string({ maxLength: 8, sensitivity: 'secret' }) }), responses: { 200: t.object({ ok: t.boolean() }) } } });
const server = createServer();
server.routes(contract, { item: (request) => { const sid: string = request.cookies.sid; return { status: 200, body: { ok: sid.length > 0 } }; } }); // BAD
`,
  clientCookieInput: `import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
const contract = defineContract({ item: { method: 'GET', path: '/item', cookies: t.object({ theme: t.string({ maxLength: 8 }) }), responses: { 200: t.object({ ok: t.boolean() }) } } });
const client = createClient(contract, { baseUrl: 'http://127.0.0.1:1' });
await client.item({ cookies: { theme: 'dark' } }); // BAD
`,
  clientCookieWithQuery: `import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
const contract = defineContract({ item: { method: 'GET', path: '/item', query: t.object({ n: t.integer() }), cookies: t.object({ theme: t.string({ maxLength: 8 }) }), responses: { 200: t.object({ ok: t.boolean() }) } } });
const client = createClient(contract, { baseUrl: 'http://127.0.0.1:1' });
await client.item({ query: { n: 1 }, cookies: { theme: 'dark' } }); // BAD
`,
  clientQueryOnlyControl: `import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
const contract = defineContract({ item: { method: 'GET', path: '/item', query: t.object({ n: t.integer() }), cookies: t.object({ theme: t.string({ maxLength: 8 }) }), responses: { 200: t.object({ ok: t.boolean() }) } } });
const client = createClient(contract, { baseUrl: 'http://127.0.0.1:1' });
await client.item({ query: { n: 1 } });
`,
};

async function prove(): Promise<void> {
  const problems: string[] = [];
  const summary = { rows: 0, bootRefused: 0, bootAccepted: 0, probes: 0 };
  const child = await startServerChild(fileURLToPath(import.meta.url));
  try {
    summary.rows += await exercise(problems, child.port, 'normal');
  } finally {
    await child.stop();
  }
  check(
    problems,
    child.stderr().includes('/explode 500'),
    'stderr held no line for the 500, so its secret check proves nothing',
  );
  check(
    problems,
    !child.stderr().includes(secret) && !child.stderr().includes(longSecret),
    'the secret value appears in stderr',
  );

  const diagChild = await startDiagChild(fileURLToPath(import.meta.url));
  summary.rows += await exercise(problems, diagChild.port, 'diag');
  const files = await diagChild.stopAndRead();
  check(problems, diagChild.stderr().includes('/explode 500'), 'diag child stderr held no line for the 500');
  check(
    problems,
    !diagChild.stderr().includes(secret) && !diagChild.stderr().includes(longSecret),
    'the secret value appears in the diag child stderr',
  );
  check(
    problems,
    files.names.includes('journal.jsonl') && files.names.includes('snapshot.jsonl'),
    `diag files ${files.names.join(',')}`,
  );
  check(
    problems,
    !files.text.includes(secret) && !files.text.includes(longSecret),
    'the secret value appears in a diag file',
  );

  for (const name of ['bad name', 'a;b', 'x=y', 'a,b', 'ä', 'a"b', 'a/b', 'a(b)', 'a b', '']) {
    // biome-ignore lint/performance/noAwaitInLoops: Serial boots keep one listener at a time.
    const outcome = await tryBoot(name);
    if (outcome.startsWith('refused')) {
      summary.bootRefused++;
    }
    check(problems, outcome.startsWith('refused'), `cookie name ${JSON.stringify(name)} was ${outcome}`);
  }
  for (const name of ['theme', '__Host-sid', 'a.b', 'a-b_c', 'Theme', 'a!b#c']) {
    // biome-ignore lint/performance/noAwaitInLoops: Serial boots keep one listener at a time.
    const outcome = await tryBoot(name);
    if (outcome.startsWith('accepted')) {
      summary.bootAccepted++;
    }
    check(problems, outcome.startsWith('accepted'), `cookie name ${JSON.stringify(name)} was ${outcome}`);
  }

  const sources = Object.values(probes);
  const results = compileProbes(sources);
  const keys = Object.keys(probes);
  const mustCompile = new Set(['typed', 'clientQueryOnlyControl']);
  for (const [index, key] of keys.entries()) {
    const result = results[index];
    summary.probes++;
    if (mustCompile.has(key)) {
      check(problems, result?.status === 0, `compile probe ${key} must compile: ${result?.errors.join(' | ')}`);
    } else {
      check(
        problems,
        (result?.errors.length ?? 0) > 0 && result?.status !== 0,
        `compile probe ${key} compiled; it must not`,
      );
    }
  }
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await prove();
}
