// Does:  Samples the server's CPU time and the generator's own, and says which of the two was saturated.
// Holds: Server CPU comes from the kernel's per-process counters in /proc, never from wall time.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { errorCode } from './bench-error.ts';
import type { Bound } from './types.ts';
import { generatorCeilingPercent, saturationPercent } from './values.ts';

interface CpuReading {
  readonly generatorCpuPercent: number;
  readonly serverCpuPercent: number | null;
  readonly serverCpuMicroseconds: number | null;
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

const serverTicks = (pid: number): number | null => {
  if (clockTicksPerSecond === null) {
    return null;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    // Why: proc_pid_stat(5) puts utime and stime at fields 14 and 15; fields[0] here is field 3.
    return Number(fields[11]) + Number(fields[12]);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

export function startCpuSample(serverPid: number): () => CpuReading {
  const ticksBefore = serverTicks(serverPid);
  const usageBefore = process.cpuUsage();
  const wallBefore = performance.now();
  return () => {
    const wallMicroseconds = (performance.now() - wallBefore) * 1000;
    const usage = process.cpuUsage(usageBefore);
    const ticksAfter = serverTicks(serverPid);
    const serverCpuMicroseconds =
      ticksBefore === null || ticksAfter === null || clockTicksPerSecond === null
        ? null
        : ((ticksAfter - ticksBefore) / clockTicksPerSecond) * 1_000_000;
    return {
      generatorCpuPercent: ((usage.user + usage.system) / wallMicroseconds) * 100,
      serverCpuPercent: serverCpuMicroseconds === null ? null : (serverCpuMicroseconds * 100) / wallMicroseconds,
      serverCpuMicroseconds,
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
