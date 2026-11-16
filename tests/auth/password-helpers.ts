// Does:  Proves the Argon2id password helpers round-trip, refuse hostile records unread and keep their bounds.
// Holds: Bounded input, parameters, concurrency and queue; rehash advice is pure; no helper has a store or user argument.
// biome-ignore-all lint/performance/noAwaitInLoops: each case must finish before the next so timings are separate
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: hostile options deliberately break the option types
// biome-ignore-all lint/security/noSecrets: hash text and canary passwords are fixtures, not secrets

import { argon2Sync } from 'node:crypto';
import * as passwordEntry from '@skeld/auth/password';
import { hashPassword, needsRehash, verifyPassword } from '@skeld/auth/password';
import { Secret } from '@skeld/core/secret';
import { createReport } from './rig/report.ts';
import { sleep } from './rig/util.ts';

const report = createReport(
  'v06',
  'password-helpers',
  'the helpers hash and verify through platform Argon2id, parse a record before allocating, bound input, parameters, concurrency and queue, advise rehash, and touch no store',
);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64').replace(/=+$/, '');
const pw = (text: string): Secret<string> => new Secret(text);
const ms = (since: number): number => Math.round(performance.now() - since);

interface Spec {
  readonly alg?: string;
  readonly v?: string;
  readonly m: number;
  readonly t: number;
  readonly p: number;
  readonly salt: Uint8Array;
  readonly tag: Uint8Array;
  readonly extra?: string;
}
function encode(spec: Spec): string {
  const params = `m=${spec.m},t=${spec.t},p=${spec.p}${spec.extra ?? ''}`;
  return `$${spec.alg ?? 'argon2id'}$${spec.v ?? 'v=19'}$${params}$${b64(spec.salt)}$${b64(spec.tag)}`;
}
function derive(password: string, spec: Pick<Spec, 'm' | 't' | 'p' | 'salt'>, tagLength: number): Buffer {
  return argon2Sync('argon2id', {
    message: Buffer.from(password),
    nonce: spec.salt,
    parallelism: spec.p,
    tagLength,
    memory: spec.m,
    passes: spec.t,
  });
}
async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof Error
      ? `${error.constructor.name} ${Reflect.get(error, 'code')} "${error.message}"`
      : 'threw';
  }
}
function codeSync(run: () => unknown): string {
  try {
    run();
    return 'returned';
  } catch (error) {
    return error instanceof Error
      ? `${error.constructor.name} ${Reflect.get(error, 'code')} "${error.message}"`
      : 'threw';
  }
}

await report.run('round trips', async () => {
  const first = await hashPassword(pw('correct horse battery staple'));
  const second = await hashPassword(pw('correct horse battery staple'));
  const hash = first.kind === 'hashed' ? first.hash : '';
  report.check(
    'a default hash is $argon2id$v=19$m=19456,t=2,p=1 with an unpadded 16-byte salt and 32-byte tag',
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(hash),
    hash.replace(/\$[A-Za-z0-9+/]{43}$/, '$<tag>'),
  );
  report.check(
    'two hashes of one password differ (a random salt each)',
    second.kind === 'hashed' && second.hash !== hash,
    'salts differ',
  );
  const parts = hash.split('$');
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const tag = Buffer.from(parts[5] ?? '', 'base64');
  const oracle = derive('correct horse battery staple', { m: 19456, t: 2, p: 1, salt }, 32);
  report.check(
    "the tag is the platform's own Argon2id of the password, salt and parameters (node:crypto argon2Sync)",
    oracle.equals(tag),
    `tag ${tag.length} bytes, salt ${salt.length} bytes`,
  );
  report.check(
    'verify answers match for the right password and mismatch for a wrong one',
    (await verifyPassword(pw('correct horse battery staple'), hash)).kind === 'match' &&
      (await verifyPassword(pw('correct horse battery stapl'), hash)).kind === 'mismatch',
    'match / mismatch',
  );
  const outside = encode({
    m: 19456,
    t: 2,
    p: 1,
    salt: Buffer.alloc(16, 7),
    tag: derive('outside', { m: 19456, t: 2, p: 1, salt: Buffer.alloc(16, 7) }, 32),
  });
  report.check(
    'verify accepts a hash another implementation made (node:crypto), same parameters',
    (await verifyPassword(pw('outside'), outside)).kind === 'match',
    'match',
  );
  const tiny = encode({
    m: 8,
    t: 1,
    p: 1,
    salt: Buffer.alloc(8, 3),
    tag: derive('tiny', { m: 8, t: 1, p: 1, salt: Buffer.alloc(8, 3) }, 16),
  });
  const wide = encode({
    m: 64,
    t: 1,
    p: 4,
    salt: Buffer.alloc(64, 4),
    tag: derive('wide', { m: 64, t: 1, p: 4, salt: Buffer.alloc(64, 4) }, 64),
  });
  report.check(
    'verify accepts the edges of the accepted record: m=8,t=1,p=1 with an 8-byte salt and 16-byte tag; p=4 with a 64-byte salt and 64-byte tag',
    (await verifyPassword(pw('tiny'), tiny)).kind === 'match' &&
      (await verifyPassword(pw('wide'), wide)).kind === 'match',
    'match, match',
  );
  const raised = await hashPassword(pw('raised'), { cost: { memoryKiB: 32768, passes: 3 } });
  report.check(
    'a raised cost is written into the record and verifies with the stored parameters',
    raised.kind === 'hashed' &&
      raised.hash.includes('m=32768,t=3,p=1') &&
      (await verifyPassword(pw('raised'), raised.hash)).kind === 'match',
    raised.kind === 'hashed' ? raised.hash.split('$')[3] : raised.kind,
  );
});

await report.run('bounded password input', async () => {
  const edge = 'a'.repeat(1024);
  const hashedEdge = await hashPassword(pw(edge));
  report.check(
    'a password of exactly 1,024 bytes hashes and verifies',
    hashedEdge.kind === 'hashed' && (await verifyPassword(pw(edge), hashedEdge.hash)).kind === 'match',
    hashedEdge.kind,
  );
  const multi = `${'€'.repeat(341)}a`;
  const hashedMulti = await hashPassword(pw(multi));
  report.check(
    'the bound counts UTF-8 bytes: 341 three-byte characters and one more byte is exactly 1,024 and accepted',
    Buffer.byteLength(multi) === 1024 && hashedMulti.kind === 'hashed',
    `${Buffer.byteLength(multi)} bytes -> ${hashedMulti.kind}`,
  );
  const started = performance.now();
  const results = await Promise.all([
    hashPassword(pw('')),
    hashPassword(pw('a'.repeat(1025))),
    hashPassword(pw('€'.repeat(342))),
  ]);
  report.check(
    'an empty password, 1,025 bytes and 342 three-byte characters (1,026 bytes) are invalid_password and computed nothing (under 20 ms for all three)',
    results.every((r) => r.kind === 'invalid_password') && ms(started) < 20,
    `${results.map((r) => r.kind).join(', ')} in ${ms(started)} ms`,
  );
  const record = hashedEdge.kind === 'hashed' ? hashedEdge.hash : '';
  const t0 = performance.now();
  const long = await verifyPassword(pw('a'.repeat(1025)), record);
  const empty = await verifyPassword(pw(''), record);
  report.check(
    'verify of a password outside 1 to 1,024 bytes is mismatch and computed nothing (under 20 ms for both)',
    long.kind === 'mismatch' && empty.kind === 'mismatch' && ms(t0) < 20,
    `${long.kind}, ${empty.kind} in ${ms(t0)} ms`,
  );
});

await report.run('hostile records are refused unread', async () => {
  const salt = Buffer.alloc(16, 9);
  const tag = Buffer.alloc(32, 9);
  const base: Spec = { m: 19456, t: 2, p: 1, salt, tag };
  const hostile: [string, string][] = [
    ['empty text', ''],
    ['garbage', 'not a hash'],
    ['text over 256 characters', `${encode(base)}${'A'.repeat(260)}`],
    ['argon2i', encode({ ...base, alg: 'argon2i' })],
    ['argon2d', encode({ ...base, alg: 'argon2d' })],
    ['version 16', encode({ ...base, v: 'v=16' })],
    ['memory 7', encode({ ...base, m: 7 })],
    ['memory 262,145', encode({ ...base, m: 262_145 })],
    ['memory 4,194,304 (4 GiB) with one pass', encode({ ...base, m: 4_194_304, t: 1 })],
    ['memory below 8 times parallelism', encode({ ...base, m: 24, p: 4 })],
    ['passes 0', encode({ ...base, t: 0 })],
    ['passes 17', encode({ ...base, t: 17 })],
    ['parallelism 0', encode({ ...base, p: 0 })],
    ['parallelism 5', encode({ ...base, p: 5, m: 64 })],
    ['memory times passes over 1,048,576', encode({ ...base, m: 262_144, t: 5 })],
    ['a salt of 7 bytes', encode({ ...base, salt: Buffer.alloc(7, 1) })],
    ['a salt of 65 bytes', encode({ ...base, salt: Buffer.alloc(65, 1) })],
    ['a tag of 15 bytes', encode({ ...base, tag: Buffer.alloc(15, 1) })],
    ['a tag of 65 bytes', encode({ ...base, tag: Buffer.alloc(65, 1) })],
    ['an extra parameter', encode({ ...base, extra: ',x=1' })],
    ['a missing field', `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}`],
    ['padded base64', `${encode(base)}=`],
    ['a salt that is not base64', `$argon2id$v=19$m=19456,t=2,p=1$!!!!$${b64(tag)}`],
  ];
  const rssBefore = process.memoryUsage().rss;
  for (const [name, record] of hostile) {
    const started = performance.now();
    const verdict = await verifyPassword(pw('anything'), record);
    report.check(
      `verify refuses ${name} as invalid_hash, never mismatch, before computing (under 10 ms)`,
      verdict.kind === 'invalid_hash' && ms(started) < 10,
      `${verdict.kind} in ${ms(started)} ms`,
    );
  }
  const grown = Math.round((process.memoryUsage().rss - rssBefore) / 1_048_576);
  report.check(
    'refusing the 4 GiB record and the rest allocated no memory worth the name (RSS growth under 100 MiB)',
    grown < 100,
    `RSS grew ${grown} MiB over ${hostile.length} refusals`,
  );
  report.check(
    'needsRehash answers true for every one of them, and never throws',
    hostile.every(([, record]) => needsRehash(record) === true),
    `${hostile.length} records`,
  );
});

await report.run('rehash advice', async () => {
  await sleep(0);
  const salt = Buffer.alloc(16, 5);
  const make = (m: number, t: number, p: number, saltBytes = 16, tagBytes = 32): string => {
    const s = saltBytes === 16 ? salt : Buffer.alloc(saltBytes, 5);
    return encode({ m, t, p, salt: s, tag: Buffer.alloc(tagBytes, 1) });
  };
  const rows: [string, string, boolean][] = [
    ['the default cost', make(19456, 2, 1), false],
    ['a higher cost', make(65536, 3, 1), false],
    ['memory below the default', make(8192, 2, 1), true],
    ['passes below the default', make(19456, 1, 1), true],
    ['parallelism 2', make(19456, 2, 2), true],
    ['a salt under 16 bytes', make(19456, 2, 1, 8), true],
    ['a tag under 32 bytes', make(19456, 2, 1, 16, 16), true],
    ['text that does not parse', 'plaintext', true],
  ];
  for (const [name, record, want] of rows) {
    report.check(`needsRehash is ${want} for ${name}`, needsRehash(record) === want, String(needsRehash(record)));
  }
  const dflt = make(19456, 2, 1);
  report.check(
    'against a higher wanted cost the default hash is true, against an equal one false',
    needsRehash(dflt, { memoryKiB: 32768, passes: 3 }) === true &&
      needsRehash(dflt, { memoryKiB: 19456, passes: 2 }) === false,
    'true / false',
  );
  const started = performance.now();
  for (let i = 0; i < 20_000; i++) {
    needsRehash(dflt);
  }
  report.check(
    'needsRehash is synchronous and pure: 20,000 calls return in under 500 ms with no queue involved',
    ms(started) < 500,
    `${ms(started)} ms`,
  );
});

await report.run('option and cost bounds', async () => {
  const cases: [string, () => Promise<unknown>][] = [
    ['memory 19,455 (below the minimum)', () => hashPassword(pw('x'), { cost: { memoryKiB: 19455, passes: 2 } })],
    ['passes 1 (below the minimum)', () => hashPassword(pw('x'), { cost: { memoryKiB: 19456, passes: 1 } })],
    ['memory 262,145', () => hashPassword(pw('x'), { cost: { memoryKiB: 262_145, passes: 2 } })],
    ['passes 17', () => hashPassword(pw('x'), { cost: { memoryKiB: 19456, passes: 17 } })],
    ['memory times passes over 1,048,576', () => hashPassword(pw('x'), { cost: { memoryKiB: 262_144, passes: 5 } })],
    ['a fractional passes', () => hashPassword(pw('x'), { cost: { memoryKiB: 19456, passes: 2.5 } })],
    ['an unknown cost key', () => hashPassword(pw('x'), { cost: { memoryKiB: 19456, passes: 2, zzz: 1 } as never })],
    ['an unknown option key on hashPassword', () => hashPassword(pw('x'), { zzz: 1 } as never)],
    ['an unknown option key on verifyPassword', () => verifyPassword(pw('x'), 'h', { zzz: 1 } as never)],
  ];
  for (const [name, run] of cases) {
    const started = performance.now();
    const outcome = await code(run());
    report.check(
      `${name} rejects AuthError INVALID_INPUT with the fixed message, no key name and no computing (under 10 ms)`,
      outcome === 'AuthError INVALID_INPUT "invalid input"' && ms(started) < 10,
      `${outcome} in ${ms(started)} ms`,
    );
  }
  const sync = codeSync(() => needsRehash('x', { memoryKiB: 1, passes: 2 }));
  report.check(
    'needsRehash with a cost out of bounds throws AuthError INVALID_INPUT',
    sync === 'AuthError INVALID_INPUT "invalid input"',
    sync,
  );
  const canary = await code(hashPassword(pw('CANARY-PASSWORD-TEXT'), { cost: { memoryKiB: 1, passes: 2 } }));
  report.check('no password text is in an error message', !canary.includes('CANARY'), canary);
});

await report.run('concurrency, queue and deadline', async () => {
  const base = await hashPassword(pw('queue'));
  const record = base.kind === 'hashed' ? base.hash : '';
  const warm = performance.now();
  await verifyPassword(pw('queue'), record);
  const unit = Math.max(ms(warm), 1);
  const started = performance.now();
  const burst = await Promise.all(
    Array.from({ length: 100 }, () => {
      const at = performance.now();
      return verifyPassword(pw('queue'), record).then((verdict) => ({ verdict: verdict.kind, took: ms(at) }));
    }),
  );
  const total = ms(started);
  const busy = burst.filter((item) => item.verdict === 'busy');
  const done = burst.filter((item) => item.verdict === 'match');
  report.check(
    '100 simultaneous verifications: 2 run, 64 wait, the other 34 are busy at once',
    done.length === 66 && busy.length === 34 && busy.every((item) => item.took < 100),
    `${done.length} matched, ${busy.length} busy (the slowest busy answer after ${Math.max(...busy.map((item) => item.took))} ms)`,
  );
  report.check(
    'two run at a time: 66 verifications took about 33 single-verification times, not 66 and not 11',
    total > unit * 22 && total < unit * 48,
    `one verification ${unit} ms; the 66 took ${total} ms (${(total / unit).toFixed(1)} units); host shared with other work`,
  );

  const heavy = { memoryKiB: 65_536, passes: 8 };
  const heavyHash = await hashPassword(pw('heavy'), { cost: heavy });
  const heavyRecord = heavyHash.kind === 'hashed' ? heavyHash.hash : '';
  await verifyPassword(pw('heavy'), heavyRecord);
  const probes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const probe = performance.now();
    await verifyPassword(pw('heavy'), heavyRecord);
    probes.push(ms(probe));
  }
  const heavyUnit = Math.min(...probes);
  const count = Math.min(66, 2 * Math.ceil(5500 / heavyUnit) + 4);
  const begin = performance.now();
  const waiters = await Promise.all(
    Array.from({ length: count }, () =>
      verifyPassword(pw('heavy'), heavyRecord).then((verdict) => ({ verdict: verdict.kind, took: ms(begin) })),
    ),
  );
  const timedOut = waiters.filter((item) => item.verdict === 'busy');
  const slowest = Math.max(...timedOut.map((item) => item.took), 0);
  const fastest = Math.min(...timedOut.map((item) => item.took), Number.POSITIVE_INFINITY);
  report.check(
    'a waiter that has waited 5,000 ms is busy, and the ones ahead of it finished: matches before, busy at the deadline',
    timedOut.length >= 1 && fastest >= 4900 && slowest <= 5600 && waiters.some((item) => item.verdict === 'match'),
    `${count} verifications of ${heavyUnit} ms each: ${waiters.filter((item) => item.verdict === 'match').length} matched, ${timedOut.length} busy, first busy at ${fastest} ms and last at ${slowest} ms`,
  );

  const abortWaiting = new AbortController();
  const occupy = [verifyPassword(pw('heavy'), heavyRecord), verifyPassword(pw('heavy'), heavyRecord)];
  const waitingCall = verifyPassword(pw('heavy'), heavyRecord, { signal: abortWaiting.signal });
  const atAbort = performance.now();
  abortWaiting.abort();
  const aborted = await waitingCall;
  report.check(
    'a caller aborted while it waits is busy at once',
    aborted.kind === 'busy' && ms(atAbort) < 50,
    `${aborted.kind} after ${ms(atAbort)} ms`,
  );
  await Promise.all(occupy);

  const timeThird = async (abort: boolean): Promise<{ finish: number; busy: boolean }> => {
    const controllers = [new AbortController(), new AbortController()];
    const begun = performance.now();
    const holders = controllers.map((controller) =>
      verifyPassword(pw('heavy'), heavyRecord, { signal: controller.signal }),
    );
    await sleep(100);
    if (abort) {
      for (const controller of controllers) {
        controller.abort();
      }
    }
    const answers = await Promise.all(holders);
    const third = await verifyPassword(pw('heavy'), heavyRecord);
    return {
      finish: ms(begun),
      busy: third.kind === 'match' && answers.every((answer) => answer.kind === (abort ? 'busy' : 'match')),
    };
  };
  const control = await timeThird(false);
  const abortedRun = await timeThird(true);
  report.check(
    'a caller aborted while its computation runs is busy at once, but the slot stays taken until the computation ends',
    abortedRun.busy && control.busy && abortedRun.finish >= control.finish * 0.7,
    `the third verification finished ${abortedRun.finish} ms after the holders began when they were aborted at 100 ms, and ${control.finish} ms when they ran on; had the slot been freed at the abort it would have finished in about ${heavyUnit + 100} ms`,
  );
});

report.check(
  'the ./password subpath exports hashPassword, needsRehash and verifyPassword and nothing else',
  JSON.stringify(Object.keys(passwordEntry).sort()) === '["hashPassword","needsRehash","verifyPassword"]',
  Object.keys(passwordEntry).join(', '),
);
report.check(
  'no helper takes a store, a user or an account: hashing takes (password, options), verifying (password, hash, options), advice (hash, cost)',
  hashPassword.length === 2 && verifyPassword.length === 3 && needsRehash.length === 2,
  `declared parameters: ${hashPassword.length}, ${verifyPassword.length}, ${needsRehash.length}; the proof ran them in a process with no store, server or createAuth`,
);
report.finish();
