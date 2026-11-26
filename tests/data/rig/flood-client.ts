// Does:  Child process that runs one query into a fixture's flood and reports its own memory figures.
// Holds: It prints one JSON line of counts and codes; the fixture's address and bound come from its environment.

import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { sql } from '@skeld/data/sql';
import { bootPool } from './boot-pool.ts';

setFlagsFromString('--expose-gc');
const found: unknown = runInNewContext('gc');
if (typeof found !== 'function') {
  throw new Error('the collector is not exposed');
}
const collect = (): void => {
  found();
};

const port = Number(process.env.VA_PORT);
const bound = Number(process.env.VA_BOUND);
const booted = await bootPool(`postgres://u@127.0.0.1:${port}/d?sslmode=require`, {
  ca: process.env.VA_CA ?? '',
  bounds: { maxResultBytes: bound },
});
const database = booted.database;
if (booted.failure !== null || database === null) {
  process.stdout.write(`${JSON.stringify({ bootFailed: booted.failure?.message ?? 'no database' })}\n`);
  process.exit(1);
}
const owner = booted.server;
const base = process.memoryUsage().arrayBuffers;
// Why: A buffer held on purpose proves the figure moves, so a rise of 0 below means nothing was buffered.
let held: Buffer | null = Buffer.alloc(bound * 2, 1);
const controlRise = process.memoryUsage().arrayBuffers - base;
held.fill(0);
held = null;
collect();
collect();
const before = process.memoryUsage().arrayBuffers;
let peak = before;
const sampler = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().arrayBuffers);
}, 1);
let code = 'resolved';
try {
  await database.for(owner).query(sql`select 1`);
} catch (error) {
  code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
}
clearInterval(sampler);
const settled = process.memoryUsage().arrayBuffers;
collect();
collect();
const collected = process.memoryUsage().arrayBuffers;
const next = await database.for(owner).query(sql`select 1`);
await booted.finish();
process.stdout.write(
  `${JSON.stringify({ code, bound, controlRise, peakRise: peak - before, settledRise: settled - before, collectedRise: collected - before, next })}\n`,
);
