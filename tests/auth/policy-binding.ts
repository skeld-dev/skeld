// Does:  Proves policy binding on real routes: schema binding, callback order, strict results, deadline, release.
// Holds: Each outcome is judged by status, exact body, the callbacks that ran, and the grants a spy gate saw released.

import { AuthError } from '@skeld/auth/auth-error';
import { definePolicy, isGrant } from '@skeld/auth/policy';
import { createAuth } from '@skeld/auth/server';
import { defineContract } from '@skeld/core/contract';
import { object, string } from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import {
  cookieHeader,
  createLogs,
  establishFor,
  get,
  openSocket,
  ORIGIN,
  type Reply,
  send,
  series,
  sleepMs,
} from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, type Kind, makeRig, rigKinds } from './support-store.ts';

const statement =
  'a policy input is the route schema node and arrives validated and typed; tenant membership is judged before the action; a callback that throws, answers a non-boolean or a bad tenant name never admits; load, tenant and action share one 5,000 ms deadline and a late answer is ignored; a grant is released exactly once on every way a request ends';
const report = createReport('v02', statement);

const SECRET_TEXT = 'CALLBACK-SECRET-TEXT';
const NOT_FOUND = '{"status":404,"code":"NOT_FOUND","message":"Not found"}';
const DENIED = '{"status":403,"code":"ACCESS_DENIED","message":"Access denied"}';
const INTERNAL_CODE = '"code":"INTERNAL"';
const UNAVAILABLE = '{"status":503,"code":"AUTH_UNAVAILABLE","message":"Service unavailable"}';

const idSchema = string({ maxLength: 40 });
const modeSchema = string({ maxLength: 40 });
const nSchema = string({ maxLength: 8 });
const okBody = { 200: object({ ok: string({ maxLength: 16 }) }) };

const routes = defineContract({
  tRead: {
    method: 'GET',
    path: '/t/:id',
    params: object({ id: idSchema }),
    query: object({ q: modeSchema }),
    access: { policy: 'tenanted', action: 'read' },
    responses: okBody,
  },
  tWrite: {
    method: 'GET',
    path: '/tw/:id',
    params: object({ id: idSchema }),
    query: object({ q: modeSchema }),
    access: { policy: 'tenanted', action: 'write' },
    responses: okBody,
  },
  hRead: {
    method: 'GET',
    path: '/h/:id',
    params: object({ id: idSchema }),
    query: object({ q: modeSchema }),
    access: { policy: 'hidden', action: 'read' },
    responses: okBody,
  },
  bound: {
    method: 'POST',
    path: '/b/:id',
    params: object({ id: idSchema }),
    body: object({ n: nSchema }),
    access: { policy: 'bodied', action: 'read' },
    responses: okBody,
  },
});

interface Resource {
  readonly id: string;
  readonly tenant: string;
  readonly mode: string;
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

async function bindingCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const logs = createLogs();
  const order: string[] = [];
  const inputs: string[] = [];
  const handlerRuns = new Map<string, number>();
  const issued: unknown[] = [];
  const releases = new Map<unknown, number>();
  const tenanted = definePolicy('tenanted', {
    credentials: ['session'],
    input: { id: idSchema, q: modeSchema },
    load: async ({ input }): Promise<Resource | null> => {
      order.push('load');
      inputs.push(`${input.id}|${input.q}`);
      if (input.q === 'load-throws') {
        throw new Error(SECRET_TEXT);
      }
      if (input.q === 'load-hangs') {
        return never<Resource | null>();
      }
      if (input.q === 'slow-both') {
        await sleepMs(3000);
      }
      return input.id === 'missing' ? null : { id: input.id, tenant: input.id.slice(0, 2), mode: input.q };
    },
    tenant: {
      of: (resource) => {
        order.push('of');
        switch (resource.mode) {
          case 'of-number':
            return JSON.parse('5');
          case 'of-empty':
            return '';
          case 'of-129':
            return 'x'.repeat(129);
          case 'of-throws':
            throw new Error(SECRET_TEXT);
          default:
            return resource.tenant;
        }
      },
      member: async ({ tenant, resource }) => {
        order.push('member');
        switch (resource.mode) {
          case 'member-string':
            return JSON.parse('"true"');
          case 'member-one':
            return JSON.parse('1');
          case 'member-null':
            return JSON.parse('null');
          case 'member-throws':
            throw new Error(SECRET_TEXT);
          case 'slow-both':
            await sleepMs(3000);
            return true;
          default:
            return tenant === 't1';
        }
      },
    },
    actions: {
      read: async ({ resource }) => {
        order.push('action');
        switch (resource.mode) {
          case 'action-string':
            return JSON.parse('"yes"');
          case 'action-throws':
            throw new Error(SECRET_TEXT);
          case 'late-true':
            await sleepMs(5300);
            return true;
          default:
            return true;
        }
      },
      write: () => {
        order.push('action');
        return false;
      },
    },
  });
  const hidden = definePolicy('hidden', {
    credentials: ['session'],
    denial: 'not_found',
    input: { id: idSchema, q: modeSchema },
    load: ({ input }) => {
      order.push('load');
      return { id: input.id, tenant: 't1', mode: input.q };
    },
    actions: {
      read: () => {
        order.push('action');
        return false;
      },
    },
  });
  const bodied = definePolicy('bodied', {
    credentials: ['session'],
    input: { id: idSchema, n: nSchema },
    load: ({ input }) => {
      order.push('load');
      inputs.push(`${input.id}|${input.n}|${typeof input.n}`);
      return { id: input.id };
    },
    actions: { read: () => true },
  });
  const auth = createAuth({ store: rig.store, origin: ORIGIN, policies: [tenanted, hidden, bodied] });
  const spy: typeof auth.gate = {
    boot: (context) => auth.gate.boot(context),
    bind: (route) => {
      const bound = auth.gate.bind(route);
      if (bound === null || 'finding' in bound) {
        return bound;
      }
      const { authorize, release } = bound;
      return {
        ...bound,
        authorize:
          authorize === null
            ? null
            : async (principal, input, request) => {
                const outcome = await authorize(principal, input, request);
                if (outcome.kind === 'admit') {
                  issued.push(outcome.grant);
                }
                return outcome;
              },
        release:
          release === null
            ? null
            : (grant) => {
                releases.set(grant, (releases.get(grant) ?? 0) + 1);
                release(grant);
              },
      };
    },
  };
  const server = createServer({
    gate: spy,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    log: { thresholds: { security: 'info', app: 'info' }, sink: logs.sink },
  });
  const run = (name: string): void => {
    handlerRuns.set(name, (handlerRuns.get(name) ?? 0) + 1);
  };
  server.routes(
    routes,
    {
      tRead: (request) => {
        run('tRead');
        return { status: 200, body: { ok: request.grant.resource.id.slice(0, 16) } };
      },
      tWrite: () => {
        run('tWrite');
        return { status: 200, body: { ok: 'w' } };
      },
      hRead: () => {
        run('hRead');
        return { status: 200, body: { ok: 'h' } };
      },
      bound: () => {
        run('bound');
        return { status: 200, body: { ok: 'b' } };
      },
    },
    { csrf: { mode: 'strict' } },
  );
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const port = address.port;
  try {
    const alice = await establishFor(auth.sessions, 'alice');
    const cookie = cookieHeader('__Host-skeld', alice.token);
    const ask = (path: string, method = 'GET', body?: string): Promise<Reply> => {
      order.length = 0;
      return send(port, {
        method,
        path,
        headers: [cookie, ...(method === 'POST' ? [`x-csrf-token: ${alice.csrf}`] : [])],
        ...(body === undefined ? {} : { body }),
      });
    };

    inputs.length = 0;
    const ok = await ask('/t/t1-doc?q=fine');
    report.check(
      `${label} schema binding: load receives the validated params and query values, then tenant.of, tenant.member and the action run in that order`,
      ok.status === 200 && inputs.join(';') === 't1-doc|fine' && order.join(',') === 'load,of,member,action',
      `${ok.status}; load saw ${inputs.join(';')}; order ${order.join(',')}`,
    );
    inputs.length = 0;
    const bodyBound = await ask('/b/abc', 'POST', '{"n":"seven"}');
    report.check(
      `${label} schema binding: a body field bound to a policy input arrives as the validated string`,
      bodyBound.status === 200 && inputs.join(';') === 'abc|seven|string',
      `${bodyBound.status}; load saw ${inputs.join(';')}`,
    );
    inputs.length = 0;
    const invalidQuery = await ask(`/t/t1-doc?q=${'x'.repeat(60)}`);
    const invalidBody = await ask('/b/abc', 'POST', '{"n":"waytoolongvalue"}');
    report.check(
      `${label} validation precedes load: an invalid query and an invalid body are 400 and no policy callback runs`,
      invalidQuery.status === 400 && invalidBody.status === 400 && inputs.length === 0,
      `${invalidQuery.status} ${invalidBody.status}; load calls ${inputs.length}`,
    );

    const tenantMiss = await ask('/t/t2-doc?q=fine');
    const orderMiss = order.join(',');
    const missing = await ask('/t/missing?q=fine');
    const orderMissing = order.join(',');
    const hiddenAction = await ask('/h/anything?q=fine');
    const orderHidden = order.join(',');
    const denied = await ask('/tw/t1-doc?q=fine');
    const orderDenied = order.join(',');
    report.check(
      `${label} tenant membership precedes the action: a tenant that is not a member is 404 and the action never runs`,
      tenantMiss.status === 404 && tenantMiss.body === NOT_FOUND && orderMiss === 'load,of,member',
      `${tenantMiss.status} ${tenantMiss.body}; order ${orderMiss}`,
    );
    report.check(
      `${label} a load answering null is 404 with the same body and nothing after load runs`,
      missing.status === 404 && missing.body === NOT_FOUND && orderMissing === 'load',
      `${missing.status} ${missing.body}; order ${orderMissing}`,
    );
    report.check(
      `${label} denial not_found: an action answering false is the same 404 body`,
      hiddenAction.status === 404 && hiddenAction.body === NOT_FOUND && orderHidden === 'load,action',
      `${hiddenAction.status} ${hiddenAction.body}; order ${orderHidden}`,
    );
    report.check(
      `${label} an action answering false under the default denial is 403 ACCESS_DENIED after the tenant check`,
      denied.status === 403 && denied.body === DENIED && orderDenied === 'load,of,member,action',
      `${denied.status} ${denied.body}; order ${orderDenied}`,
    );
    await logs.settle();
    const hiddenRecords = logs.named('skeld.refuse.access_hidden');
    const missingRecords = logs.named('skeld.refuse.resource_missing');
    report.check(
      `${label} one 404 body and two event names: access_hidden twice (tenant, denial) and resource_missing once`,
      hiddenRecords.length === 2 &&
        missingRecords.length === 1 &&
        missingRecords.every((r) => r.severity === 'info') &&
        hiddenRecords.every((r) => r.severity === 'warn'),
      `${hiddenRecords.length} access_hidden, ${missingRecords.length} resource_missing`,
    );

    const faults: [string, string, string, string, string][] = [
      ['load throws', 'load-throws', 'policy.load', 'threw', 'load'],
      ['tenant.of answers a number', 'of-number', 'policy.tenant', 'malformed', 'load,of'],
      ['tenant.of answers an empty tenant name', 'of-empty', 'policy.tenant', 'malformed', 'load,of'],
      ['tenant.of answers a name of 129 characters', 'of-129', 'policy.tenant', 'malformed', 'load,of'],
      ['tenant.of throws', 'of-throws', 'policy.tenant', 'threw', 'load,of'],
      ['tenant.member answers the string "true"', 'member-string', 'policy.tenant', 'malformed', 'load,of,member'],
      ['tenant.member answers 1', 'member-one', 'policy.tenant', 'malformed', 'load,of,member'],
      ['tenant.member answers null', 'member-null', 'policy.tenant', 'malformed', 'load,of,member'],
      ['tenant.member throws', 'member-throws', 'policy.tenant', 'threw', 'load,of,member'],
      ['the action answers the string "yes"', 'action-string', 'policy.action', 'malformed', 'load,of,member,action'],
      ['the action throws', 'action-throws', 'policy.action', 'threw', 'load,of,member,action'],
    ];
    await series(faults, async ([name, mode, callback, cause, expectedOrder]) => {
      await logs.settle();
      const failedBefore = logs.named('auth.callback.failed').length;
      const grantsBefore = issued.length;
      const runsBefore = handlerRuns.get('tRead') ?? 0;
      const reply = await ask(`/t/t1-doc?q=${mode}`);
      await logs.settle();
      const failed = logs.named('auth.callback.failed').slice(failedBefore);
      report.check(
        `${label} ${name}: 500, no grant, no handler, one auth.callback.failed for ${callback} with cause ${cause}`,
        reply.status === 500 &&
          reply.body.includes(INTERNAL_CODE) &&
          issued.length === grantsBefore &&
          (handlerRuns.get('tRead') ?? 0) === runsBefore &&
          failed.length === 1 &&
          failed[0]?.fields['auth.callback'] === callback &&
          failed[0]?.fields['auth.cause'] === cause &&
          order.join(',') === expectedOrder,
        `${reply.status}; ${failed.map((r) => `${String(r.fields['auth.callback'])}/${String(r.fields['auth.cause'])}`).join(',')}; order ${order.join(',')}`,
      );
    });
    report.check(
      `${label} the thrown text is in no response body and no record`,
      !logs.text().includes(SECRET_TEXT),
      '',
    );

    await logs.settle();
    const failedBefore = logs.named('auth.callback.failed').length;
    const grantsBefore = issued.length;
    const runsBefore = handlerRuns.get('tRead') ?? 0;
    const began = performance.now();
    const timed = await Promise.all(
      ['slow-both', 'load-hangs', 'late-true'].map(async (mode) => {
        const reply = await get(port, `/t/t1-${mode}?q=${mode}`, [cookie]);
        return { mode, reply, elapsed: Math.round(performance.now() - began) };
      }),
    );
    await sleepMs(900);
    await logs.settle();
    const deadlines = logs.named('auth.callback.failed').slice(failedBefore);
    const pairs = deadlines.map((r) => `${String(r.fields['auth.callback'])}/${String(r.fields['auth.cause'])}`).sort();
    report.check(
      `${label} load, tenant and action share one 5,000 ms deadline: 503 at 4,990 to 5,500 ms, no grant, no handler, the late answer ignored`,
      timed.every(
        ({ reply, elapsed }) =>
          reply.status === 503 && reply.body === UNAVAILABLE && elapsed >= 4990 && elapsed <= 5500,
      ) &&
        issued.length === grantsBefore &&
        (handlerRuns.get('tRead') ?? 0) === runsBefore,
      timed.map(({ mode, reply, elapsed }) => `${mode}: ${reply.status} after ${elapsed} ms`).join('; '),
    );
    report.check(
      `${label} each deadline is one auth.callback.failed naming the callback that was running (3 s load then 3 s member: policy.tenant)`,
      pairs.join(',') === 'policy.action/deadline,policy.load/deadline,policy.tenant/deadline',
      pairs.join(','),
    );
  } finally {
    await server.close();
    await rig.dispose();
  }
}

async function releaseCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const logs = createLogs();
  const issued: unknown[] = [];
  const releases = new Map<unknown, number>();
  const plain = definePolicy('plain', { credentials: ['session'], actions: { use: () => true, no: () => false } });
  const useGrant = plain.operation('use', () => 'used');
  const auth = createAuth({ store: rig.store, origin: ORIGIN, policies: [plain] });
  const spy: typeof auth.gate = {
    boot: (context) => auth.gate.boot(context),
    bind: (route) => {
      const bound = auth.gate.bind(route);
      if (bound === null || 'finding' in bound) {
        return bound;
      }
      const { authorize, release } = bound;
      return {
        ...bound,
        authorize:
          authorize === null
            ? null
            : async (principal, input, request) => {
                const outcome = await authorize(principal, input, request);
                if (outcome.kind === 'admit') {
                  issued.push(outcome.grant);
                }
                return outcome;
              },
        release:
          release === null
            ? null
            : (grant) => {
                releases.set(grant, (releases.get(grant) ?? 0) + 1);
                release(grant);
              },
      };
    },
  };
  const ends = defineContract({
    ok: { method: 'GET', path: '/e/ok', access: { policy: 'plain', action: 'use' }, responses: okBody },
    throws: { method: 'GET', path: '/e/throws', access: { policy: 'plain', action: 'use' }, responses: okBody },
    slow: { method: 'GET', path: '/e/slow', access: { policy: 'plain', action: 'use' }, responses: okBody },
    gone: { method: 'GET', path: '/e/gone', access: { policy: 'plain', action: 'use' }, responses: okBody },
    pre: { method: 'GET', path: '/e/pre', access: { policy: 'plain', action: 'use' }, responses: okBody },
    preThrows: { method: 'GET', path: '/e/pre-throws', access: { policy: 'plain', action: 'use' }, responses: okBody },
    early: { method: 'GET', path: '/e/early', access: { policy: 'plain', action: 'use' }, responses: okBody },
    denied: { method: 'GET', path: '/e/denied', access: { policy: 'plain', action: 'no' }, responses: okBody },
  });
  let afterTimeout = 'not run';
  let liveAtTimeout = 'not run';
  let handlerStarts = 0;
  const server = createServer({
    gate: spy,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    handlerTimeoutMs: 700,
    log: { thresholds: { security: 'info', app: 'info' }, sink: logs.sink },
  });
  server.addHook('onRequest', (context) => {
    if (context.route.name === 'early') {
      context.send({ status: 202 });
    }
  });
  server.addHook('preHandler', (context) => {
    if (context.route.name === 'pre') {
      context.send({ status: 202 });
    }
    if (context.route.name === 'preThrows') {
      throw new Error(SECRET_TEXT);
    }
  });
  server.routes(
    ends,
    {
      ok: () => ({ status: 200, body: { ok: 'ok' } }),
      throws: () => {
        throw new Error(SECRET_TEXT);
      },
      slow: async (request) => {
        handlerStarts++;
        await sleepMs(1500);
        liveAtTimeout = String(isGrant(request.grant));
        try {
          afterTimeout = useGrant(request.grant);
        } catch (error) {
          afterTimeout = error instanceof AuthError ? error.code : String(error);
        }
        return { status: 200, body: { ok: 'late' } };
      },
      gone: async () => {
        handlerStarts++;
        await sleepMs(500);
        return { status: 200, body: { ok: 'gone' } };
      },
      pre: () => ({ status: 200, body: { ok: 'pre' } }),
      preThrows: () => ({ status: 200, body: { ok: 'pre' } }),
      early: () => ({ status: 200, body: { ok: 'early' } }),
      denied: () => ({ status: 200, body: { ok: 'denied' } }),
    },
    { csrf: { mode: 'strict' } },
  );
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const port = address.port;
  try {
    const alice = await establishFor(auth.sessions, 'alice');
    const cookie = cookieHeader('__Host-skeld', alice.token);
    const single = (): number => (issued.length === 0 ? -1 : (releases.get(issued[issued.length - 1]) ?? 0));
    const way = async (
      name: string,
      status: (reply: Reply) => boolean,
      grantExpected: boolean,
      drive?: () => Promise<void>,
    ): Promise<void> => {
      const before = issued.length;
      let reply: Reply | null = null;
      if (drive === undefined) {
        reply = await get(port, `/e/${name === 'preThrows' ? 'pre-throws' : name}`, [cookie]);
      } else {
        await drive();
      }
      await sleepMs(1900);
      const delta = issued.length - before;
      report.check(
        `${label} ${name}: ${grantExpected ? 'one grant issued and released exactly once' : 'no grant issued and none released'}`,
        delta === (grantExpected ? 1 : 0) && (!grantExpected || single() === 1) && (reply === null || status(reply)),
        `${reply === null ? 'client left' : reply.status}; grants issued ${delta}; releases of it ${grantExpected ? single() : 0}`,
      );
    };
    await way('ok', (reply) => reply.status === 200, true);
    await way('throws', (reply) => reply.status === 500, true);
    await way('pre', (reply) => reply.status === 202, true);
    await way('preThrows', (reply) => reply.status === 500, true);
    await way('early', (reply) => reply.status === 202, false);
    await way('denied', (reply) => reply.status === 403, false);
    const slowBefore = issued.length;
    const slowReply = get(port, '/e/slow', [cookie]);
    await sleepMs(1000);
    const grantAtTimeout = issued[slowBefore];
    const releasedAtTimeout = releases.get(grantAtTimeout) ?? 0;
    const timedOut = await slowReply;
    await sleepMs(900);
    report.check(
      `${label} a handler past its deadline: the response is 503, the grant was already released once at the deadline (1,000 ms in, the handler still running)`,
      timedOut.status === 503 &&
        releasedAtTimeout === 1 &&
        (releases.get(grantAtTimeout) ?? 0) === 1 &&
        handlerStarts === 1,
      `${timedOut.status}; releases at 1,000 ms ${releasedAtTimeout}; releases at the end ${releases.get(grantAtTimeout) ?? 0}`,
    );
    report.check(
      `${label} the handler that outlived its deadline holds a released grant: isGrant false, its operation GRANT_RELEASED`,
      liveAtTimeout === 'false' && afterTimeout === 'GRANT_RELEASED',
      `isGrant ${liveAtTimeout}; operation ${afterTimeout}`,
    );
    await way(
      'gone',
      () => true,
      true,
      async () => {
        const client = await openSocket(port);
        client.write(`GET /e/gone HTTP/1.1\r\nhost: x\r\ncookie: __Host-skeld=${alice.token}\r\n\r\n`);
        await sleepMs(200);
        client.destroy();
      },
    );
    await logs.settle();
    report.check(`${label} the thrown text reaches no record`, !logs.text().includes(SECRET_TEXT), '');
    const total = [...releases.values()].reduce((sum, count) => sum + count, 0);
    report.check(
      `${label} over every way a request ended, grants issued equal releases and no grant was released twice`,
      total === issued.length && [...releases.values()].every((count) => count === 1),
      `${issued.length} issued, ${total} releases`,
    );
  } finally {
    await server.close();
    await rig.dispose();
  }
}

function definitionCases(): void {
  const names: [string, string][] = [
    ['an empty name', ''],
    ['a name that starts with a digit', '1abc'],
    ['a name of 65 characters', 'a'.repeat(65)],
    ['a reserved auth. name', 'auth.mine'],
    ['a name with a space', 'a b'],
  ];
  for (const [name, value] of names) {
    let outcome = 'defined';
    try {
      definePolicy(value, { credentials: ['session'], actions: { read: () => true } });
    } catch (error) {
      outcome = error instanceof TypeError ? 'TypeError' : String(error);
    }
    report.check(`[definition] ${name}: TypeError`, outcome === 'TypeError', outcome);
  }
}

async function bootCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const attempts: [string, Parameters<typeof definePolicy>[1]][] = [
    ['a tenant without load', JSON.parse('{"credentials":["session"],"tenant":{},"actions":{"read":null}}')],
    ['a policy with no actions', JSON.parse('{"credentials":["session"],"actions":{}}')],
    ['a credentials list of an unknown kind', JSON.parse('{"credentials":["cookie"],"actions":{"read":null}}')],
    [
      'a denial that is neither value',
      JSON.parse('{"credentials":["session"],"denial":"hide","actions":{"read":null}}'),
    ],
  ];
  await series(attempts, async ([name, options]) => {
    const rig = await makeRig(kind, { attach: false });
    try {
      const auth = createAuth({ store: rig.store, origin: ORIGIN, policies: [definePolicy('weird', options)] });
      const server = createServer({ gate: auth.gate, publicOrigin: ORIGIN, log: false });
      const outcome = await server.listen({ host: '127.0.0.1', port: 0 }).then(
        async () => {
          await server.close();
          return 'listened';
        },
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      report.check(
        `${label} ${name} refuses boot with GATE_FAILED naming the policies`,
        outcome.startsWith('gate failed: policies: policies[0]'),
        outcome,
      );
    } finally {
      await rig.dispose();
    }
  });
}

try {
  definitionCases();
  await series(rigKinds, async (kind) => {
    await report.run(`[${kind}] binding cases`, () => bindingCases(kind));
    await report.run(`[${kind}] release cases`, () => releaseCases(kind));
    await report.run(`[${kind}] policy option cases`, () => bootCases(kind));
  });
} finally {
  await cleanAll();
}
report.finish();
