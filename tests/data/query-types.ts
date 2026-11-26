// Does:  Proves by compiling query text comes from sql alone, a type argument is refused and a bare row is unknown.
// Holds: Each line marked BAD must draw an error and no other line may, so a broken import cannot pass for the refusal.

import { check, createReport } from '../support/support-proof.ts';
import { compileProbes } from '../support/support-compile.ts';

const probe = `import * as t from '@skeld/core/schema';
import type { BoundDatabase, Queryable, ReservedConnection } from '@skeld/data/database';
import { sql } from '@skeld/data/sql';

declare const bound: BoundDatabase;
declare const tx: Queryable;
declare const conn: ReservedConnection;
declare const request: string;

const Person = t.object({ id: t.integer(), name: t.string({ maxLength: 10 }), admin: t.boolean() });

const loose = await bound.query(sql\`select id from people where name = \${request}\`);
const looseValue: unknown = loose[0]?.id;
const inTx = await tx.query(sql\`select 1\`);
const onConnection = await conn.query(sql\`select 1\`);
const typed = await bound.query(sql\`select id, name, admin from people\`, Person);
const first = typed[0];
if (first !== undefined) {
  const id: number = first.id;
  const name: string = first.name;
  const admin: boolean = first.admin;
  void [id, name, admin];
}
void [looseValue, inTx, onConnection];

await bound.query('select 1'); // BAD string-on-bound
await tx.query('select 1'); // BAD string-on-transaction
await conn.query('select 1'); // BAD string-on-reserved
await bound.query('select 1', Person); // BAD string-with-schema
await bound.query(\`select \${request}\`); // BAD template-string
await bound.query({ text: 'select 1', values: [] }); // BAD object-of-text
await bound.query<{ id: number }>(sql\`select 1\`); // BAD type-argument
await tx.query<{ id: number }>(sql\`select 1\`); // BAD type-argument-on-transaction
const asNumber: number = loose[0]?.id; // BAD schemaless-as-number
const asString: string = loose[0]?.name; // BAD schemaless-as-string
const asRow: { id: number } = loose[0]; // BAD schemaless-row-typed
void [asNumber, asString, asRow];
`;

const report = createReport();
const lines = probe.split('\n');
const expected = lines.flatMap((text, at) => {
  const marked = /\/\/ BAD (\S+)$/.exec(text);
  return marked?.[1] === undefined ? [] : [{ name: marked[1], line: at + 1 }];
});

const compiled = compileProbes([probe])[0];
if (compiled === undefined) {
  throw new Error('the probe was not compiled');
}
const drawn = new Set(compiled.diagnostics.filter((d) => d.file === 'probe.ts').map((d) => d.line));
const bad = new Set(expected.map((one) => one.line));

for (const one of expected) {
  const problems: string[] = [];
  check(problems, drawn.has(one.line), `line ${one.line} compiled`);
  report.result(`${one.name} is refused at compile time`, problems, `error on line ${one.line}`);
}

const stray = [...drawn].filter((line) => !bad.has(line));
const controls: string[] = [];
check(
  controls,
  stray.length === 0,
  `unmarked lines drew errors (${stray.join(', ')}): ${compiled.errors
    .filter((e) => !/\/\/ BAD/.test(e))
    .slice(0, 3)
    .join(' | ')}`,
);
check(
  controls,
  compiled.diagnostics.every((d) => d.file === 'probe.ts'),
  'an error came from outside the probe',
);
report.result(
  'a query built by sql, with or without a row schema, compiles and is typed by the schema',
  controls,
  'no unmarked line drew an error',
);
report.finish();
