// Does:  Samples the server's CPU time, split by mode and by thread, and the generator's own; says which was saturated.
// Holds: Server CPU comes from the kernel's /proc counters for the process and its main thread, never from wall time.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { errorCode } from './bench-error.ts';
import type { Bound, CpuSplit } from './types.ts';
import { generatorCeilingPercent, saturationPercent } from './values.ts';

interface CpuReading {
  readonly generatorCpuPercent: number;
  readonly serverCpuPercent: number | null;
  readonly serverCpuMicroseconds: number | null;
  readonly serverCpuSplitMicroseconds: CpuSplit | null;
}

interface ServerTicks {
  readonly user: number;
  readonly system: number;
  readonly mainThread: number;
}

const readClockTicks = (): number | null => {
  try {
    const ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', stdio: 'pipe' }).trim());
    return Number.isSafeInteger(ticks) && ticks > 0 ? ticks : null;
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || (error instanceof Error && 'status' in error)) {
      return null;
    }
    throw error;
  }
};

const clockTicksPerSecond = readClockTicks();

const userAndSystemTicks = (statPath: string): readonly [number, number] => {
  const stat = readFileSync(statPath, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  // Why: proc_pid_stat(5) puts utime and stime at fields 14 and 15; fields[0] here is field 3.
  return [Number(fields[11]), Number(fields[12])];
};

const serverTicks = (pid: number): ServerTicks | null => {
  if (clockTicksPerSecond === null) {
    return null;
  }
  try {
    const [user, system] = userAndSystemTicks(`/proc/${pid}/stat`);
    // Why: The process file totals every thread; task/ holds each thread's own, and the main thread's id is the pid.
    const [mainUser, mainSystem] = userAndSystemTicks(`/proc/${pid}/task/${pid}/stat`);
    return { user, system, mainThread: mainUser + mainSystem };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

function splitBetween(before: ServerTicks, after: ServerTicks, ticksPerSecond: number): CpuSplit {
  const microseconds = (ticks: number): number => (ticks / ticksPerSecond) * 1_000_000;
  const user = microseconds(after.user - before.user);
  const system = microseconds(after.system - before.system);
  const mainThread = microseconds(after.mainThread - before.mainThread);
  return { user, system, mainThread, otherThreads: user + system - mainThread };
}

export function splitPerRequest(split: CpuSplit, requests: number): CpuSplit {
  return {
    user: split.user / requests,
    system: split.system / requests,
    mainThread: split.mainThread / requests,
    otherThreads: split.otherThreads / requests,
  };
}

export function startCpuSample(serverPid: number): () => CpuReading {
  const ticksBefore = serverTicks(serverPid);
  const usageBefore = process.cpuUsage();
  const wallBefore = performance.now();
  return () => {
    const wallMicroseconds = (performance.now() - wallBefore) * 1000;
    const usage = process.cpuUsage(usageBefore);
    const ticksAfter = serverTicks(serverPid);
    const measured = ticksBefore !== null && ticksAfter !== null && clockTicksPerSecond !== null;
    // Why: The total is converted from the summed ticks, so it is the same figure the split's two halves approximate.
    const serverCpuMicroseconds = measured
      ? ((ticksAfter.user + ticksAfter.system - ticksBefore.user - ticksBefore.system) / clockTicksPerSecond) *
        1_000_000
      : null;
    const split = measured ? splitBetween(ticksBefore, ticksAfter, clockTicksPerSecond) : null;
    return {
      generatorCpuPercent: ((usage.user + usage.system) / wallMicroseconds) * 100,
      serverCpuPercent: serverCpuMicroseconds === null ? null : (serverCpuMicroseconds * 100) / wallMicroseconds,
      serverCpuMicroseconds,
      serverCpuSplitMicroseconds: split,
    };
  };
}

export function classifyBound(reading: CpuReading): Bound {
  if (reading.generatorCpuPercent >= generatorCeilingPercent) {
    return 'generator';
  }
  if (reading.serverCpuPercent === null) {
    return 'unknown';
  }
  return reading.serverCpuPercent >= saturationPercent ? 'server' : 'neither';
}
