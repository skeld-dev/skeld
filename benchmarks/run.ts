import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BenchError, errorCode } from './bench-error.ts';
import { type CheckHooks, checkServers } from './check.ts';
import {
  captureMachine,
  captureSoftware,
  loadAverage,
  nodeOptions,
  type Packages,
  resolvePackages,
} from './environment.ts';
import { loadAutocannon } from './load.ts';
import { type Lock, takeLock } from './lock.ts';
import { helpText, parseOptions, wantsHelp } from './options.ts';
import { pinRunner } from './pinning.ts';
import { reportFile, writeRunFiles } from './report.ts';
import { runSchedule } from './rounds.ts';
import { estimatedMinutes } from './schedule.ts';
import type { ServerProcess } from './server-process.ts';
import { summarize } from './statistics.ts';
import {
  busyWarning,
  checkLines,
  displayPath,
  isoSeconds,
  nonConformingWarning,
  staleLockWarning,
  startLines,
  summaryLines,
} from './terminal.ts';
import type { BenchSample, BenchVerdict, RunOptions } from './types.ts';
import { busyLoadAverage, connections, workers } from './values.ts';
import { decideVerdict, deviations, type RunEnding } from './verdict.ts';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const printError = (error: BenchError): void => {
  err(`error: ${error.message}`);
  for (const line of error.detail) {
    err(line);
  }
};

const warnings: string[] = [];
const warn = (text: string): void => {
  warnings.push(text);
  err(`warning: ${text}`);
};

const argv = process.argv.slice(2);
if (wantsHelp(argv)) {
  process.stdout.write(helpText);
  process.exit(0);
}

const parseOrExit = (): RunOptions => {
  try {
    return parseOptions(argv);
  } catch (error) {
    if (error instanceof BenchError) {
      printError(error);
      process.exit(error.exitCode);
    }
    throw error;
  }
};

const takeLockOrExit = (): Lock => {
  try {
    return takeLock();
  } catch (error) {
    if (error instanceof BenchError) {
      printError(error);
      process.exit(error.exitCode);
    }
    throw error;
  }
};

const options = parseOrExit();
const lock = takeLockOrExit();
process.on('exit', () => {
  lock.release();
});
if (lock.replacedPid !== null) {
  warn(staleLockWarning(lock.replacedPid));
}
const pinning = pinRunner();

let interruptions = 0;
const interruption = Promise.withResolvers<void>();
let current: ServerProcess | null = null;
let round = 0;

const onSignal = (): void => {
  interruptions++;
  if (interruptions === 1) {
    interruption.resolve();
    return;
  }
  current?.kill();
  process.exit(130);
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

const interrupted = (): boolean => interruptions > 0;

const hooks: CheckHooks = {
  interrupted,
  track: (server) => {
    current = server;
  },
  warn,
  fail: (error) => {
    if (!interrupted()) {
      printError(error);
    }
  },
};

const runCheckMode = async (): Promise<never> => {
  const rows = await checkServers(options.servers, options.routes, pinning.serverCommand, hooks);
  if (interrupted()) {
    process.exit(130);
  }
  for (const line of checkLines(rows, options.servers.length, options.routes.length)) {
    out(line);
  }
  process.exit(rows.every((row) => row.passed) ? 0 : 3);
};

const createRunDirectory = (outFolder: string, runDirectory: string): void => {
  try {
    mkdirSync(outFolder, { recursive: true });
    mkdirSync(runDirectory);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EEXIST') {
      throw new BenchError(
        3,
        `${displayPath(runDirectory)}/ already exists. Wait a second and run again, or choose another folder with --out.`,
      );
    }
    if (code !== null) {
      throw new BenchError(3, `cannot write to ${displayPath(outFolder)}/: ${code}. Choose another folder with --out.`);
    }
    throw error;
  }
};

const failureReason = (error: BenchError): string =>
  error.reason ?? error.message.replace(/ Its last output:$/, '').replace(/\.$/, '');

const runMeasure = async (packages: Packages): Promise<never> => {
  const startedAt = new Date();
  const id = `${isoSeconds(startedAt).replaceAll(':', '-')}-p${options.pipelining}`;
  const outFolder = resolve(options.out);
  const runDirectory = join(outFolder, id);
  createRunDirectory(outFolder, runDirectory);
  const reportPath = displayPath(reportFile(runDirectory));
  const loadAverageStart = loadAverage();
  const machine = captureMachine(loadAverageStart, pinning);
  const software = captureSoftware(packages, pinning);
  const found = deviations(options, {
    node: process.version,
    fastify: packages.fastify,
    nodeOptions: nodeOptions(),
    pinning: pinning.deviation,
  });
  for (const line of startLines(options, runDirectory, estimatedMinutes(options), pinning.deviation)) {
    err(line);
  }
  if (found.length > 0) {
    warn(nonConformingWarning(found));
  }
  if (loadAverageStart > busyLoadAverage) {
    warn(busyWarning(loadAverageStart));
  }
  const samples: BenchSample[] = [];

  const finish = (ending: RunEnding): { verdict: BenchVerdict; written: boolean } => {
    const summary = summarize(samples, options.servers, options.routes);
    const verdict = decideVerdict(ending, found, samples, summary);
    let written = true;
    try {
      writeRunFiles(runDirectory, {
        id,
        status: ending.status,
        startedAt: isoSeconds(startedAt),
        finishedAt: isoSeconds(new Date()),
        options: {
          connections,
          workers,
          pipelining: options.pipelining,
          warmUpSeconds: options.warmUpSeconds,
          durationSeconds: options.durationSeconds,
          rounds: options.rounds,
          servers: options.servers,
          routes: options.routes,
        },
        conforming: found.length === 0,
        deviations: found,
        machine: { ...machine, loadAverageEnd: loadAverage() },
        software,
        samples,
        summary,
        verdict,
        warnings,
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === null) {
        throw error;
      }
      err(`error: cannot write ${reportPath}: ${code}.`);
      written = false;
    }
    const measured = samples.filter((sample) => sample.kind === 'measured').length;
    for (const line of summaryLines(summary, verdict, measured, reportFile(runDirectory))) {
      out(line);
    }
    return { verdict, written };
  };

  const rows = await checkServers(options.servers, options.routes, pinning.serverCommand, hooks);
  if (interrupted()) {
    finish({ status: 'interrupted', round: 1 });
    err(`Interrupted in round 1. Servers stopped; the partial report is in ${reportPath}.`);
    process.exit(130);
  }
  for (const line of checkLines(rows, options.servers.length, options.routes.length)) {
    err(line);
  }
  if (!rows.every((row) => row.passed)) {
    process.exit(3);
  }

  let outcome: RunEnding;
  let failure: BenchError | null = null;
  try {
    const result = await runSchedule({
      options,
      autocannon: loadAutocannon(),
      serverCommand: pinning.serverCommand,
      samples,
      interruption: interruption.promise,
      interrupted,
      track: (server) => {
        current = server;
      },
      enterRound: (entered) => {
        round = entered;
      },
      warn,
      progress: err,
    });
    outcome = result === 'complete' ? { status: 'complete' } : { status: 'interrupted', round };
  } catch (error) {
    if (!(error instanceof BenchError)) {
      throw error;
    }
    if (interrupted()) {
      outcome = { status: 'interrupted', round };
    } else {
      failure = error;
      outcome = { status: 'invalid', reason: failureReason(error) };
    }
  }

  const { verdict, written } = finish(outcome);
  if (failure !== null) {
    printError(failure);
    err(`The partial report is in ${reportPath}.`);
    process.exit(4);
  }
  if (outcome.status === 'interrupted') {
    err(`Interrupted in round ${round}. Servers stopped; the partial report is in ${reportPath}.`);
    process.exit(130);
  }
  if (!written) {
    process.exit(4);
  }
  process.exit(verdict.kind === 'below' ? 1 : 0);
};

try {
  const packages = resolvePackages();
  await (options.check ? runCheckMode() : runMeasure(packages));
} catch (error) {
  if (error instanceof BenchError) {
    printError(error);
    process.exit(error.exitCode);
  }
  throw error;
}
