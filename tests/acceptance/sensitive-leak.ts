// Does:  Proves that a secret or personal value a client sends never appears in a 400, a 500, stderr or stdout.
// Holds: Random tokens are sent as the values, so any echo of one is detected.

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { check, conclude } from './support.ts';
import { parseRecords, untilStdout } from './support-log.ts';
import { startServerChild } from './support-typesystem.ts';

const statement =
  'a secret token and a personal token sent in a request never appear in its 400 body, its 500 body or any stderr or stdout line; the secret token appears in no response; the personal token appears only in the 200 body that declares the field';

const contract = defineContract({
  accept: {
    method: 'POST',
    path: '/accept',
    body: t.object({
      user: t.string({ maxLength: 36 }),
      password: t.string({ maxLength: 64, sensitivity: 'secret' }),
      email: t.string({ maxLength: 64, sensitivity: 'personal' }),
      age: t.integer({ minimum: 0, maximum: 150 }),
    }),
    responses: { 200: t.object({ email: t.string({ maxLength: 64, sensitivity: 'personal' }) }) },
  },
  explode: {
    method: 'POST',
    path: '/explode',
    body: t.object({
      password: t.string({ maxLength: 64, sensitivity: 'secret' }),
      email: t.string({ maxLength: 64, sensitivity: 'personal' }),
    }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
  narrow: {
    method: 'POST',
    path: '/narrow',
    body: t.object({
      password: t.string({ maxLength: 8, sensitivity: 'secret' }),
      email: t.string({ maxLength: 8, sensitivity: 'personal' }),
    }),
    responses: { 200: t.object({ ok: t.boolean() }) },
  },
});

async function serve(): Promise<void> {
  const server = createServer();
  server.routes(contract, {
    accept: ({ body }) => ({ status: 200, body: { email: body.email } }),
    explode: ({ body }) => {
      throw new Error(`could not process ${String(body.password)}`);
    },
    narrow: () => ({ status: 200, body: { ok: true } }),
  });
  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  process.stdout.write(`listening ${port}\n`);
}

interface Observed {
  status: number;
  text: string;
}

async function main(): Promise<void> {
  const secretToken = randomBytes(16).toString('hex');
  const personalToken = randomBytes(16).toString('hex');
  const problems: string[] = [];
  const child = await startServerChild(fileURLToPath(import.meta.url));
  const send = async (path: string, body: unknown): Promise<Observed> => {
    const response = await fetch(`http://127.0.0.1:${child.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const headers = [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n');
    return { status: response.status, text: `${headers}\n${await response.text()}` };
  };
  const valid = { user: 'ada', password: secretToken, email: personalToken, age: 36 };
  try {
    const refused = await send('/accept', { ...valid, age: 'thirty-six' });
    check(problems, refused.status === 400, `the 400 request answered ${refused.status}`);
    check(problems, !refused.text.includes(secretToken), 'the secret token appears in the 400 response');
    check(problems, !refused.text.includes(personalToken), 'the personal token appears in the 400 response');

    const failed = await send('/explode', { password: secretToken, email: personalToken });
    check(problems, failed.status === 500, `the throwing request answered ${failed.status}`);
    check(problems, !failed.text.includes(secretToken), 'the secret token appears in the 500 response');
    check(problems, !failed.text.includes(personalToken), 'the personal token appears in the 500 response');

    const accepted = await send('/accept', valid);
    check(problems, accepted.status === 200, `the succeeding request answered ${accepted.status}`);
    check(problems, !accepted.text.includes(secretToken), 'the secret token appears in the 200 response');
    check(problems, accepted.text.includes(personalToken), 'the personal token is missing from the 200 response');

    const narrow = await send('/narrow', { password: secretToken, email: personalToken });
    check(problems, narrow.status === 400, `the request with over-long sensitive fields answered ${narrow.status}`);
    check(problems, !narrow.text.includes(secretToken), 'the secret token appears in the 400 of its own field');
    check(problems, !narrow.text.includes(personalToken), 'the personal token appears in the 400 of its own field');
    await untilStdout(child, (records) => records.some((record) => record?.['http.route'] === '/explode'));
  } finally {
    await child.stop();
  }
  const stderr = child.stderr();
  const stdout = child.stdout();
  check(
    problems,
    parseRecords(stdout).some(
      (record) =>
        record?.event_name === 'skeld.request.error' &&
        record['skeld.reason'] === 'thrown' &&
        record['http.route'] === '/explode' &&
        record['http.response.status_code'] === 500,
    ),
    'stdout held no skeld.request.error record for the 500, so its token check proves nothing',
  );
  check(problems, !stderr.includes(secretToken), 'the secret token appears in stderr');
  check(problems, !stderr.includes(personalToken), 'the personal token appears in stderr');
  check(problems, !stdout.includes(secretToken), 'the secret token appears in stdout');
  check(problems, !stdout.includes(personalToken), 'the personal token appears in stdout');
  conclude(statement, problems);
}

if (process.argv[2] === 'serve') {
  await serve();
} else {
  await main();
}
