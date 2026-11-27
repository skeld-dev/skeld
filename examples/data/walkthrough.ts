import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@skeld/core/client';
import { startExample } from './app.ts';
import { bankContract } from './contract.ts';
import { migrate } from './migration.ts';

// Runs the example end to end: migrates the database, starts the service on a free port, calls each route,
// exceeds the transfer limit once and closes. On SQLite it uses a new temporary file; with DATABASE_URL set it
// uses that database and leaves the balances as it found them. Exits with status 1 if any check fails.

const dir = mkdtempSync(join(tmpdir(), 'skeld-data-example-'));
// The migration's and the server's JSON logs are held here so the walkthrough's lines stay readable; they are
// printed if a check fails.
const records: string[] = [];
let failed = 0;
const check = (label: string, ok: boolean): void => {
  process.stdout.write(`  ${ok ? 'ok' : 'FAIL'}  ${label}\n`);
  if (!ok) {
    failed += 1;
  }
};

const sqlitePath = join(dir, 'bank.db');
const logSink = (lines: readonly string[]): void => {
  records.push(...lines);
};

try {
  await migrate({ sqlitePath, logSink });
  const example = await startExample({ port: 0, sqlitePath, logSink });
  process.stdout.write(`data example on ${example.engine}\n`);
  try {
    const client = createClient(bankContract, { baseUrl: example.url });
    const balance = async (id: string): Promise<number> => {
      const found = await client.getAccount({ params: { id } });
      if (found.status !== 200) {
        throw new Error(`GET /accounts/${id} answered ${found.status}`);
      }
      return found.body.balance;
    };

    process.stdout.write('A query with a row schema\n');
    const listed = await client.listAccounts();
    check(
      'GET /accounts lists alice and bob: 200',
      listed.status === 200 &&
        ['alice', 'bob'].every((id) => listed.body.accounts.some((account) => account.id === id)),
    );
    const missing = await client.getAccount({ params: { id: 'carol' } });
    check(
      'GET /accounts/carol: 404 ACCOUNT_NOT_FOUND',
      missing.status === 404 && missing.body.code === 'ACCOUNT_NOT_FOUND',
    );

    process.stdout.write('A transaction\n');
    const alice = await balance('alice');
    const bob = await balance('bob');
    const moved = await client.createTransfer({ body: { from: 'alice', to: 'bob', amount: 10 } });
    check('alice sends bob 10: 201', moved.status === 201 && moved.body.amount === 10);
    check('both balances moved by 10', (await balance('alice')) === alice - 10 && (await balance('bob')) === bob + 10);

    const lost = await client.createTransfer({ body: { from: 'alice', to: 'carol', amount: 5 } });
    check('alice sends carol 5: 404, carol has no account', lost.status === 404);
    check('the debit from alice was rolled back', (await balance('alice')) === alice - 10);

    const short = await client.createTransfer({ body: { from: 'alice', to: 'bob', amount: 1_000_000 } });
    check(
      'alice sends more than she has: 409 TRANSFER_REFUSED',
      short.status === 409 && short.body.code === 'TRANSFER_REFUSED',
    );

    process.stdout.write('A limited route: 5 transfers per 10 seconds per address\n');
    const back = [
      await client.createTransfer({ body: { from: 'bob', to: 'alice', amount: 5 } }),
      await client.createTransfer({ body: { from: 'bob', to: 'alice', amount: 5 } }),
    ];
    check(
      'transfers 4 and 5: 201',
      back.every((answer) => answer.status === 201),
    );
    const refused = await client.createTransfer({ body: { from: 'bob', to: 'alice', amount: 1 } });
    const retryAfter = Number(refused.headers.get('retry-after'));
    check('transfer 6: 429 RATE_LIMITED', refused.status === 429 && refused.body.code === 'RATE_LIMITED');
    check('retry-after is 1 to 10 seconds', Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 10);
    check('the refused transfer never ran', (await balance('alice')) === alice && (await balance('bob')) === bob);
  } finally {
    await example.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed > 0) {
  process.stderr.write(`${records.join('\n')}\n`);
  process.stdout.write(`walkthrough failed: ${failed} check(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('walkthrough passed\n');
}
