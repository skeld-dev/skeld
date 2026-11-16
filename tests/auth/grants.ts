// Does:  Proves a grant is registry-backed, carries its authority while its request runs and fails on every use after.
// Holds: Cases run through real requests: the grant is shared with a second request while the first is held open.

import { AuthError } from '@skeld/auth/auth-error';
import { definePolicy, type Grant, isGrant, isPrincipal } from '@skeld/auth/policy';
import { createAuth } from '@skeld/auth/server';
import { defineContract } from '@skeld/core/contract';
import { object, string } from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';
import { cookieHeader, createLogs, establishFor, get, ORIGIN, series, sleepMs } from './rig/v1-app.ts';
import { createReport } from './rig/v1-report.ts';
import { cleanAll, makeRig, rigKinds, type Kind } from './support-store.ts';

const statement =
  'a literal, a clone and a clone naming another resource are GRANT_UNKNOWN; another policy is GRANT_POLICY and another action GRANT_ACTION, each before the body; a live grant used from a second request while the first still runs succeeds; every use in every request after the first has ended is GRANT_RELEASED; isGrant is true before the release and false after';
const report = createReport('v02', statement);

interface Note {
  readonly id: string;
  readonly owner: string;
}

const idSchema = string({ maxLength: 36 });
const text = string({ maxLength: 200 });

const routes = defineContract({
  hold: {
    method: 'GET',
    path: '/hold/:id',
    params: object({ id: idSchema }),
    access: { policy: 'notes', action: 'read' },
    responses: { 200: object({ ok: text }) },
  },
  holdWrite: {
    method: 'GET',
    path: '/hold-write/:id',
    params: object({ id: idSchema }),
    access: { policy: 'notes', action: 'write' },
    responses: { 200: object({ ok: text }) },
  },
  holdOther: {
    method: 'GET',
    path: '/hold-other',
    access: { policy: 'other', action: 'read' },
    responses: { 200: object({ ok: text }) },
  },
  use: {
    method: 'GET',
    path: '/use',
    query: object({ case: string({ maxLength: 40 }) }),
    access: 'public',
    responses: { 200: object({ outcome: text, message: text }) },
  },
});

interface Gateway {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

function gateway(): Gateway {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: () => resolve() };
}

interface Captured {
  read?: Grant<'notes', 'read', Note>;
  write?: Grant<'notes', 'write', Note>;
  other?: Grant<'other', 'read', unknown>;
  loaded?: Note;
  bodyRuns: number;
  firstCall?: string;
  secondCall?: string;
  frozen?: boolean;
  liveIsGrant?: boolean;
  principalIsPrincipal?: boolean;
  principalFrozen?: boolean;
  resourceIdentity?: boolean;
  principalCopyIsPrincipal?: boolean;
}

async function grantCases(kind: Kind): Promise<void> {
  const label = `[${kind}]`;
  const rig = await makeRig(kind, { attach: false });
  const logs = createLogs();
  const captured: Captured = { bodyRuns: 0 };
  const loadedNotes = new Map<string, Note>();
  const notes = definePolicy('notes', {
    credentials: ['session'],
    input: { id: idSchema },
    load: ({ input, principal }) => {
      const note: Note = { id: input.id, owner: principal.kind === 'session' ? principal.userId : '' };
      loadedNotes.set(input.id, note);
      return note;
    },
    actions: { read: () => true, write: () => true },
  });
  const other = definePolicy('other', { credentials: ['session'], actions: { read: () => true } });
  const readNote = notes.operation('read', (grant: Grant<'notes', 'read', Note>, suffix: string) => {
    captured.bodyRuns++;
    return `${grant.resource.id}${suffix}`;
  });
  const auth = createAuth({ store: rig.store, origin: ORIGIN, policies: [notes, other] });
  const server = createServer({
    gate: auth.gate,
    publicOrigin: ORIGIN,
    csrf: { mode: 'strict' },
    log: { thresholds: { security: 'info', app: 'info' }, sink: logs.sink },
  });
  const release = { read: gateway(), write: gateway(), other: gateway() };
  const entered = { read: gateway(), write: gateway(), other: gateway() };

  const apply = (grant: unknown, suffix = ''): string => {
    try {
      return `ok:${String(Reflect.apply(readNote, undefined, [grant, suffix]))}`;
    } catch (error) {
      return error instanceof AuthError ? `${error.code}|${error.message}` : `other:${String(error)}`;
    }
  };
  const named = (name: string): string => {
    switch (name) {
      case 'live':
        return apply(captured.read, '-second');
      case 'literal':
        return apply({
          principal: captured.read?.principal,
          policy: 'notes',
          action: 'read',
          tenant: null,
          resource: captured.loaded,
          requestId: 'x',
        });
      case 'clone':
        return apply({ ...captured.read });
      case 'structured':
        return apply(structuredClone({ ...captured.read, principal: undefined }));
      case 'assigned':
        return apply(Object.create(Object(captured.read)));
      case 'cloneResource':
        return apply({ ...captured.read, resource: { id: 'someone-elses', owner: 'bob' } });
      case 'cloneAction':
        return apply({ ...captured.read, action: 'write' });
      case 'clonePrincipal':
        return apply({
          ...captured.read,
          principal: { kind: 'session', userId: 'mallory', createdAt: 1, expiresAt: 2 },
        });
      case 'otherPolicy':
        return apply(captured.other);
      case 'otherAction':
        return apply(captured.write);
      case 'null':
        return apply(null);
      case 'undefined':
        return apply(undefined);
      case 'isGrantLive':
        return String(isGrant(captured.read));
      case 'isGrantCopy':
        return String(isGrant({ ...captured.read }));
      case 'isGrantOther':
        return String(isGrant(captured.other));
      case 'isPrincipalCopy':
        return String(isPrincipal({ ...captured.read?.principal }));
      default:
        return 'unknown case';
    }
  };

  server.routes(
    routes,
    {
      hold: async (request) => {
        captured.read = request.grant;
        captured.loaded = request.grant.resource;
        captured.frozen = Object.isFrozen(request.grant);
        captured.liveIsGrant = isGrant(request.grant);
        captured.principalIsPrincipal = isPrincipal(request.principal);
        captured.principalFrozen = Object.isFrozen(request.principal);
        captured.resourceIdentity = request.grant.resource === loadedNotes.get(request.params.id);
        captured.principalCopyIsPrincipal = isPrincipal({ ...request.principal });
        captured.firstCall = apply(request.grant, '-first');
        captured.secondCall = apply(request.grant, '-again');
        entered.read.open();
        await release.read.promise;
        return { status: 200, body: { ok: 'held' } };
      },
      holdWrite: async (request) => {
        captured.write = request.grant;
        entered.write.open();
        await release.write.promise;
        return { status: 200, body: { ok: 'held' } };
      },
      holdOther: async (request) => {
        captured.other = request.grant;
        entered.other.open();
        await release.other.promise;
        return { status: 200, body: { ok: 'held' } };
      },
      use: (request) => {
        const outcome = named(request.query.case);
        const bar = outcome.indexOf('|');
        return {
          status: 200,
          body: { outcome: bar < 0 ? outcome : outcome.slice(0, bar), message: bar < 0 ? '' : outcome.slice(bar + 1) },
        };
      },
    },
    { csrf: { mode: 'strict' } },
  );
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const port = address.port;
  try {
    const alice = await establishFor(auth.sessions, 'alice');
    const cookie = cookieHeader('__Host-skeld', alice.token);
    const held = [
      get(port, '/hold/note-1', [cookie]),
      get(port, '/hold-write/note-1', [cookie]),
      get(port, '/hold-other', [cookie]),
    ];
    await Promise.all([entered.read.promise, entered.write.promise, entered.other.promise]);
    const use = async (name: string): Promise<{ outcome: string; message: string }> => {
      const reply = await get(port, `/use?case=${name}`);
      const body = reply.json();
      return { outcome: String(body.outcome), message: String(body.message) };
    };
    const expectCase = async (
      name: string,
      outcome: string,
      message: string,
      runsBefore: number,
      phase: string,
    ): Promise<void> => {
      const got = await use(name);
      report.check(
        `${label} ${phase}: ${name} is ${outcome}${message === '' ? '' : ` ("${message}")`} and the body does not run`,
        got.outcome === outcome && got.message === message && captured.bodyRuns === runsBefore,
        `${got.outcome} ${got.message}; body runs ${captured.bodyRuns - runsBefore}`,
      );
    };

    report.check(
      `${label} in the originating request: the grant and the principal are frozen, registered and carry the loaded resource by identity`,
      captured.frozen === true &&
        captured.liveIsGrant === true &&
        captured.principalIsPrincipal === true &&
        captured.principalFrozen === true &&
        captured.resourceIdentity === true &&
        captured.principalCopyIsPrincipal === false,
      JSON.stringify({
        frozen: captured.frozen,
        isGrant: captured.liveIsGrant,
        isPrincipal: captured.principalIsPrincipal,
        principalFrozen: captured.principalFrozen,
        identity: captured.resourceIdentity,
        copy: captured.principalCopyIsPrincipal,
      }),
    );
    report.check(
      `${label} a grant may be used any number of times while its request runs`,
      captured.firstCall === 'ok:note-1-first' && captured.secondCall === 'ok:note-1-again',
      `${captured.firstCall} ${captured.secondCall}`,
    );

    const runs = captured.bodyRuns;
    await expectCase('literal', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('clone', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('structured', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('assigned', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('cloneResource', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('cloneAction', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('clonePrincipal', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('null', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('undefined', 'GRANT_UNKNOWN', 'grant not issued', runs, 'while live');
    await expectCase('otherPolicy', 'GRANT_POLICY', 'grant of another policy', runs, 'while live');
    await expectCase('otherAction', 'GRANT_ACTION', 'grant of another action', runs, 'while live');

    const shared = await use('live');
    report.check(
      `${label} a live grant used from a second request (no credential at all) while the first still runs: the body runs`,
      shared.outcome === 'ok:note-1-second' && captured.bodyRuns === runs + 1,
      `${shared.outcome}; body runs ${captured.bodyRuns - runs}`,
    );
    const liveGrant = await use('isGrantLive');
    const copy = await use('isGrantCopy');
    const otherGrant = await use('isGrantOther');
    const principalCopy = await use('isPrincipalCopy');
    report.check(
      `${label} isGrant is true for the live grant and false for a copy; isPrincipal is false for a copy`,
      liveGrant.outcome === 'true' &&
        copy.outcome === 'false' &&
        otherGrant.outcome === 'true' &&
        principalCopy.outcome === 'false',
      `${liveGrant.outcome} ${copy.outcome} ${otherGrant.outcome} ${principalCopy.outcome}`,
    );

    release.read.open();
    release.write.open();
    release.other.open();
    const finished = await Promise.all(held);
    report.check(
      `${label} the three held requests finish with 200`,
      finished.every((reply) => reply.status === 200),
      finished.map((reply) => reply.status).join(','),
    );

    const after = captured.bodyRuns;
    await series([1, 2, 3], async (round) => {
      await expectCase(
        'live',
        'GRANT_RELEASED',
        'grant released',
        after,
        `after the first request ended (use ${round} in its own request)`,
      );
    });
    const released = await use('isGrantLive');
    report.check(
      `${label} isGrant is false for the grant after its request ended`,
      released.outcome === 'false',
      released.outcome,
    );
    await expectCase('clone', 'GRANT_UNKNOWN', 'grant not issued', after, 'after release');
    await expectCase('cloneResource', 'GRANT_UNKNOWN', 'grant not issued', after, 'after release');
    await expectCase(
      'otherPolicy',
      'GRANT_POLICY',
      'grant of another policy',
      after,
      'after release (provenance and policy are judged before liveness)',
    );
    await expectCase(
      'otherAction',
      'GRANT_ACTION',
      'grant of another action',
      after,
      'after release (action is judged before liveness)',
    );
    const direct = apply(captured.read, '-direct');
    report.check(
      `${label} the same grant used outside any request: GRANT_RELEASED`,
      direct === 'GRANT_RELEASED|grant released',
      direct,
    );
    report.check(
      `${label} no message of any refusal holds a value`,
      !JSON.stringify([direct]).includes('note-1'),
      direct,
    );
    await logs.settle();
    report.check(`${label} no grant refusal wrote a record naming a resource`, !logs.text().includes('note-1'), '');
  } finally {
    release.read.open();
    release.write.open();
    release.other.open();
    await sleepMs(50);
    await server.close();
    await rig.dispose();
  }
}

try {
  await series(rigKinds, async (kind) => {
    await report.run(`[${kind}] grant cases`, () => grantCases(kind));
  });
} finally {
  await cleanAll();
}
report.finish();
