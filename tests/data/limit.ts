// Does:  Proves the limiter passes at most its maximum and lets nothing through when its store has failed.
// Holds: Counts are judged by handler runs and statuses on in-memory SQLite; the store is broken by public API.

import { defineContract, errorBodySchema } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { installLimitTable, limitRoutes } from '@skeld/data/limit';
import { createSqliteDatabase } from '@skeld/data/sqlite';
import { check, conclude, rawExchange } from '../support/support.ts';

const statement =
  'with a maximum of 3, 30 concurrent requests from one address run the handler exactly 3 times and answer 429 with a retry-after of 1 to 60 to the other 27, a refused address keeps the handler away, an unlimited route passes, and once the store has lost its table a request from a new address answers 503 LIMIT_UNAVAILABLE and does not run the handler';

const ok = t.object({ ok: t.boolean() });
const contract = defineContract({
  limited: { method: 'GET', path: '/limited', responses: { 200: ok, 429: errorBodySchema, 503: errorBodySchema } },
  other: { method: 'GET', path: '/other', responses: { 200: ok } },
  breakStore: { method: 'GET', path: '/break', responses: { 200: ok } },
});

const MAX = 3;
const limits = createSqliteDatabase({ path: ':memory:' });
let handled = 0;
const server = createServer({ trustProxy: ['127.0.0.1'], log: { sink: () => undefined } });
server.register(limits.plugin);
server.register(async (scope) => installLimitTable(limits, scope));
limitRoutes(server, {
  database: limits,
  rules: { ve_rule: { max: MAX, windowSeconds: 60, routes: [contract.limited] } },
});
server.routes(contract, {
  limited: () => {
    handled += 1;
    return { status: 200, body: { ok: true } };
  },
  other: () => ({ status: 200, body: { ok: true } }),
  breakStore: async (request) => {
    await limits.for(request).reserve((connection) => connection.script('drop table skeld_data_limit_windows'));
    return { status: 200, body: { ok: true } };
  },
});

const ask = (at: number, path: string, address: string) =>
  rawExchange(at, `GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: close\r\nx-forwarded-for: ${address}\r\n\r\n`);

const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
try {
  const burst = await Promise.all(Array.from({ length: 30 }, () => ask(port, '/limited', '198.51.100.7')));
  const passed = burst.filter((r) => r.status === 200).length;
  const refused = burst.filter((r) => r.status === 429);
  check(
    problems,
    passed === MAX && handled === MAX,
    `${passed} passed and the handler ran ${handled} times against a maximum of ${MAX}`,
  );
  check(problems, refused.length === 30 - MAX, `${refused.length} answered 429, expected ${30 - MAX}`);
  check(
    problems,
    refused.every(
      (r) =>
        /^[0-9]+$/.test(r.headers.get('retry-after') ?? '') &&
        Number(r.headers.get('retry-after')) >= 1 &&
        Number(r.headers.get('retry-after')) <= 60,
    ),
    'a 429 lacked a retry-after of 1 to 60',
  );

  await Promise.all(Array.from({ length: 5 }, () => ask(port, '/limited', '198.51.100.7')));
  check(problems, handled === MAX, `a refused address reached the handler (${handled} runs)`);
  check(problems, (await ask(port, '/other', '198.51.100.7')).status === 200, 'an unlimited route did not pass');

  check(
    problems,
    (await ask(port, '/break', '198.51.100.8')).status === 200,
    'the store could not be broken through the public API',
  );
  const unavailable = await ask(port, '/limited', '198.51.100.9');
  check(
    problems,
    unavailable.status === 503,
    `a request with the store failed answered ${unavailable.status}, expected 503`,
  );
  check(problems, unavailable.body.includes('"code":"LIMIT_UNAVAILABLE"'), `the 503 body was ${unavailable.body}`);
  check(problems, handled === MAX, `a request with the store failed ran the handler (${handled} runs)`);
} finally {
  await server.close();
}
conclude(statement, problems);
