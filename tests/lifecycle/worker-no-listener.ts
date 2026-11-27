// Does:  Proves core listens on no socket on the worker path, and that a worker refuses a plugin's route.
// Holds: A ready worker child owns 0 listening sockets while a server child of the same file owns exactly 1.

// biome-ignore-all lint/performance/noAwaitInLoops: each case owns a child and a temporary folder and runs after the one before
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineContract } from '@skeld/core/contract';
import { createServer } from '@skeld/core/server';
import { createWorker } from '@skeld/core/worker';
import { createSqliteDatabase } from '@skeld/data/sqlite';
import { check, conclude } from '../support/support.ts';

type Mode = 'worker' | 'server';

interface Counts {
  tcp: number;
  tcp6: number;
  unix: number;
}

const readyLine = 'ready';

// Does:  Runs as the child: boots the SQLite plugin on a worker or a server, prints the ready line and stays alive.
async function runChild(mode: Mode, databasePath: string): Promise<void> {
  const database = createSqliteDatabase({ path: databasePath });
  if (mode === 'worker') {
    const worker = createWorker({ log: false });
    worker.register(database.plugin);
    await worker.start();
  } else {
    const server = createServer({ log: false });
    server.register(database.plugin);
    await server.listen({ port: 0, host: '127.0.0.1' });
  }
  process.stdout.write(`${readyLine}\n`);
  // Why: Core holds no handle after start, so the child would exit before the parent has looked.
  setInterval(() => undefined, 60_000);
}

// Does:  Lists the inode of every socket the process holds, listening or not.
function heldSocketInodes(pid: number): Set<string> {
  const held = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    let link: string;
    try {
      link = readlinkSync(`/proc/${pid}/fd/${fd}`);
    } catch {
      // Why: A descriptor closed between the listing and the read is not a socket the process still holds.
      continue;
    }
    const match = /^socket:\[(\d+)\]$/.exec(link);
    if (match?.[1] !== undefined) {
      held.add(match[1]);
    }
  }
  return held;
}

// Does:  Counts the process's listening TCP, TCP6 and Unix sockets from outside it, through /proc.
function listeningSockets(pid: number): Counts {
  const held = heldSocketInodes(pid);
  const counts: Counts = { tcp: 0, tcp6: 0, unix: 0 };
  for (const family of ['tcp', 'tcp6'] as const) {
    for (const line of readFileSync(`/proc/${pid}/net/${family}`, 'utf8').split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] === '0A' && held.has(fields[9] ?? '')) {
        counts[family]++;
      }
    }
  }
  for (const line of readFileSync(`/proc/${pid}/net/unix`, 'utf8').split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[3] === '00010000' && fields[5] === '01' && held.has(fields[6] ?? '')) {
      counts.unix++;
    }
  }
  return counts;
}

// Does:  Resolves with the child's ready line, or null when the child exits first; stderr gathers what it wrote.
function readyOrExit(child: ChildProcess, stderr: { text: string }): Promise<string | null> {
  return new Promise((resolve) => {
    let seen = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.text += chunk.toString('utf8');
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      seen += chunk.toString('utf8');
      const line = seen.split('\n').find((candidate) => candidate === readyLine);
      if (line !== undefined) {
        resolve(line);
      }
    });
    child.once('exit', () => resolve(null));
  });
}

// Does:  Starts one child of this file, waits for its ready line, counts its listening sockets and ends it.
async function countFor(mode: Mode, problems: string[]): Promise<Counts | null> {
  const folder = mkdtempSync(join(tmpdir(), 'skeld-worker-no-listener-'));
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ['--conditions=skeld-source', self, 'child', mode, join(folder, 'proof.db')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = { text: '' };
  try {
    const line = await readyOrExit(child, stderr);
    if (line === null) {
      problems.push(
        `the ${mode} child exited (${child.exitCode ?? child.signalCode}) before its ready line: ${stderr.text.trim()}`,
      );
      return null;
    }
    return listeningSockets(child.pid ?? 0);
  } catch (error) {
    problems.push(
      `the ${mode} child could not be observed through /proc: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    rmSync(folder, { recursive: true, force: true });
  }
}

function total(counts: Counts): number {
  return counts.tcp + counts.tcp6 + counts.unix;
}

async function socketCase(problems: string[]): Promise<void> {
  if (!existsSync('/proc/self/net/tcp') || !existsSync('/proc/self/net/unix')) {
    problems.push('this test reads the kernel socket tables and needs Linux /proc, which is absent');
    return;
  }
  const worker = await countFor('worker', problems);
  const server = await countFor('server', problems);
  if (worker !== null) {
    check(
      problems,
      total(worker) === 0,
      `a ready worker owns ${total(worker)} listening sockets: ${JSON.stringify(worker)}`,
    );
  }
  if (server !== null) {
    check(
      problems,
      total(server) === 1,
      `the server child owns ${total(server)} listening sockets, not 1: ${JSON.stringify(server)}`,
    );
  }
}

async function routeCase(problems: string[]): Promise<void> {
  const contract = defineContract({ ping: { method: 'GET', path: '/ping', responses: { 204: null } } });
  const withRoute = createWorker({ log: false });
  withRoute.register((scope) => {
    scope.routes(contract, { ping: () => ({ status: 204 }) });
  });
  try {
    await withRoute.start();
    problems.push('a worker whose plugin registers a route started');
  } catch (error) {
    const route = error instanceof Error && 'route' in error ? error.route : undefined;
    const name = typeof route === 'object' && route !== null && 'name' in route ? route.name : undefined;
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    check(problems, code === 'ROUTE_WITHOUT_LISTENER', `the route refused start with code ${String(code)}`);
    check(problems, name === 'ping', `the refusal named route ${String(name)}, not ping`);
    check(
      problems,
      error instanceof Error && error.message.includes('ping'),
      'the refusal message does not name the route',
    );
  } finally {
    await withRoute.close();
  }

  const control = createWorker({ log: false });
  control.register(() => undefined);
  try {
    await control.start();
  } catch (error) {
    problems.push(
      `the same worker without the route did not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await control.close();
  }
}

if (process.argv[2] === 'child') {
  const mode = process.argv[3] === 'server' ? 'server' : 'worker';
  await runChild(mode, process.argv[4] ?? '');
} else {
  const problems: string[] = [];
  await socketCase(problems);
  await routeCase(problems);
  conclude(
    'a ready worker with a SQLite database owns no listening socket and a server child owns one, and a worker refuses a plugin route with ROUTE_WITHOUT_LISTENER',
    problems,
  );
}
