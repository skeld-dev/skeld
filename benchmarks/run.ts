import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BenchError, errorCode } from './bench-error.ts';
import { type CheckHooks, checkServers } from './check.ts';
import {
  diagCommandLine,
  diagTarget,
  requireRecorderBuild,
  scenarioTarget,
  serverTarget,
  startTarget,
} from './diag/builds.ts';
import { readRecorderFolder } from './diag/diag-files.ts';
import {
  type DiagProcess,
  decideOverhead,
  type MeasuredWindow,
  overheadSentence,
  type ProcessGroup,
  readoutPath,
  recorderWarnings,
  writeReadout,
} from './diag/readout.ts';
import { runScenarioPass, type ScenarioPass, type ScenarioPassResult } from './diag/scenario.ts';
import { decideSecurity } from './diag/security.ts';
import {
  captureMachine,
  captureSoftware,
  inheritedDiagVariables,
  loadAverage,
  nodeOptions,
  type Packages,
  refuseConditions,
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
  diagStartLines,
  diagSummaryLines,
  displayPath,
  inheritedDiagWarning,
  isoSeconds,
  killedWarning,
  nonConformingWarning,
  staleLockWarning,
  startLines,
  summaryLines,
} from './terminal.ts';
import type { BenchSample, BenchVerdict, RunOptions } from './types.ts';
import { busyLoadAverage, connections, host, workers } from './values.ts';
import { decideVerdict, deviations, notAssessedReason, type RunEnding } from './verdict.ts';

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
let scenarioServer: ServerProcess | null = null;
let round = 0;

const onSignal = (): void => {
  interruptions++;
  if (interruptions === 1) {
    interruption.resolve();
    scenarioServer?.kill();
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
  const rows = await checkServers(options.servers.map(serverTarget), options.routes, pinning.serverCommand, hooks);
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
  const software = captureSoftware(packages, pinning, null);
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
    const verdict = decideVerdict(ending, found, samples, summary, options.diag);
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
          diag: options.diag,
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

  const rows = await checkServers(options.servers.map(serverTarget), options.routes, pinning.serverCommand, hooks);
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
      target: (visit) => serverTarget(visit.server),
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

const scenarioPasses: readonly ScenarioPass[] = ['clean', 'planted'];

interface ScenarioOutcome {
  readonly results: readonly ScenarioPassResult[];
  readonly failure: BenchError | null;
  readonly interrupted: boolean;
}

const runScenarioPassIn = async (
  diagFolder: string,
  pass: ScenarioPass,
  token: string,
  proofExitCode: 3 | 4,
): Promise<ScenarioPassResult> => {
  const folder = join(diagFolder, `scenario-${pass}`);
  const server = await startTarget(
    scenarioTarget(folder, options, token, pass === 'planted'),
    pinning.serverCommand,
    proofExitCode,
  );
  current = server;
  scenarioServer = server;
  try {
    return await runScenarioPass({
      pass,
      baseUrl: `http://${host}:${server.port}`,
      port: server.port,
      diagDir: folder,
      token,
      progress: err,
    });
  } finally {
    scenarioServer = null;
    if (await server.stop()) {
      warn(killedWarning(server.name));
    }
    current = null;
  }
};

const plantedMissing = (result: ScenarioPassResult): BenchError | null => {
  const [first, ...rest] = result.plantedMissing;
  if (first === undefined) {
    return null;
  }
  const text = (kind: string): string =>
    `the planted leak ${kind} was not detected; a clean result from this recorder proves nothing.`;
  return new BenchError(
    4,
    text(first),
    rest.map((kind) => `error: ${text(kind)}`),
  );
};

const runScenario = async (diagFolder: string, token: string, proofExitCode: 3 | 4): Promise<ScenarioOutcome> => {
  const results: ScenarioPassResult[] = [];
  for (const pass of scenarioPasses) {
    if (interrupted()) {
      return { results, failure: null, interrupted: true };
    }
    try {
      // biome-ignore lint/performance/noAwaitInLoops: each pass is its own pinned process; two would compete for core 7.
      const result = await runScenarioPassIn(diagFolder, pass, token, proofExitCode);
      results.push(result);
      const missing = plantedMissing(result);
      if (missing !== null) {
        return { results, failure: missing, interrupted: false };
      }
    } catch (error) {
      if (interrupted()) {
        return { results, failure: null, interrupted: true };
      }
      if (!(error instanceof BenchError)) {
        throw error;
      }
      return { results, failure: error, interrupted: false };
    }
  }
  return { results, failure: null, interrupted: false };
};

const readProcesses = (
  places: readonly { readonly group: ProcessGroup; readonly folder: string }[],
  problems: BenchError[],
): readonly DiagProcess[] =>
  places.flatMap(({ group, folder }) => {
    try {
      return [{ group, folder: readRecorderFolder(folder) }];
    } catch (error) {
      if (!(error instanceof BenchError)) {
        throw error;
      }
      problems.push(error);
      return [];
    }
  });

const measuredWindows = (
  samples: readonly BenchSample[],
  processes: readonly DiagProcess[],
  roundFolder: (round: number) => string,
): readonly MeasuredWindow[] =>
  samples.flatMap((sample) => {
    const process = processes.find(({ folder }) => folder.folder === roundFolder(sample.round));
    return sample.kind !== 'measured' || sample.build !== 'darkstart-diag' || process === undefined
      ? []
      : [
          {
            route: sample.route,
            windowStartMs: sample.windowStartMs,
            windowEndMs: sample.windowEndMs,
            folder: process.folder,
          },
        ];
  });

const diagRunId = (startedAt: Date): string => {
  const stamp = isoSeconds(startedAt).replaceAll(':', '-');
  return options.check ? `${stamp}-diag-check` : `${stamp}-p${options.pipelining}-diag`;
};

const diagExitCode = (findings: number, failure: BenchError | null, ending: RunEnding, written: boolean): number => {
  if (findings > 0) {
    return 1;
  }
  if (failure !== null) {
    return failure.exitCode;
  }
  if (ending.status === 'interrupted') {
    return 130;
  }
  return written ? 0 : 4;
};

interface Stage {
  readonly ending: RunEnding;
  readonly failure: BenchError | null;
}

interface DiagRun {
  readonly id: string;
  readonly startedAt: Date;
  readonly runDirectory: string;
  readonly diagFolder: string;
  readonly roundFolder: (visitRound: number) => string;
  readonly machine: ReturnType<typeof captureMachine>;
  readonly software: ReturnType<typeof captureSoftware>;
  readonly found: readonly string[];
}

const completed: Stage = { ending: { status: 'complete' }, failure: null };

const failedStage = (error: BenchError): Stage => ({
  ending: { status: 'invalid', reason: failureReason(error) },
  failure: error,
});

const prepareDiagRun = (packages: Packages): DiagRun => {
  const startedAt = new Date();
  const id = diagRunId(startedAt);
  const outFolder = resolve(options.out);
  const runDirectory = join(outFolder, id);
  createRunDirectory(outFolder, runDirectory);
  const diagFolder = join(runDirectory, 'diag');
  mkdirSync(diagFolder);
  const loadAverageStart = loadAverage();
  const found = deviations(options, {
    node: process.version,
    fastify: packages.fastify,
    nodeOptions: nodeOptions(),
    pinning: pinning.deviation,
  });
  for (const line of diagStartLines(options, runDirectory, estimatedMinutes(options), pinning.deviation)) {
    err(line);
  }
  if (found.length > 0) {
    warn(nonConformingWarning(found));
  }
  if (loadAverageStart > busyLoadAverage) {
    warn(busyWarning(loadAverageStart));
  }
  return {
    id,
    startedAt,
    runDirectory,
    diagFolder,
    roundFolder: (visitRound) => join(diagFolder, `round-${visitRound}`),
    machine: captureMachine(loadAverageStart, pinning),
    software: captureSoftware(packages, pinning, diagCommandLine(pinning.serverCommand)),
    found,
  };
};

const checkDiagBuilds = async (run: DiagRun): Promise<void> => {
  const rows = await checkServers(
    [serverTarget('darkstart'), diagTarget(join(run.diagFolder, 'check'), options)],
    options.routes,
    pinning.serverCommand,
    hooks,
  );
  if (interrupted()) {
    err('Interrupted during the start checks. Servers stopped; nothing was measured.');
    process.exit(130);
  }
  for (const line of checkLines(rows, 2, options.routes.length)) {
    err(line);
  }
  if (!rows.every((row) => row.passed)) {
    process.exit(3);
  }
};

const measureDiagBuilds = async (run: DiagRun, samples: BenchSample[]): Promise<Stage> => {
  if (options.check) {
    return completed;
  }
  try {
    const result = await runSchedule({
      options,
      autocannon: loadAutocannon(),
      serverCommand: pinning.serverCommand,
      target: (visit) =>
        visit.build === 'darkstart-diag'
          ? diagTarget(run.roundFolder(visit.round), options)
          : serverTarget(visit.server),
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
    return result === 'complete' ? completed : { ending: { status: 'interrupted', round }, failure: null };
  } catch (error) {
    if (!(error instanceof BenchError)) {
      throw error;
    }
    return interrupted() ? { ending: { status: 'interrupted', round }, failure: null } : failedStage(error);
  }
};

const scenarioStage = (outcome: ScenarioOutcome): Stage => {
  if (outcome.interrupted) {
    return { ending: { status: 'interrupted', round: null }, failure: null };
  }
  return outcome.failure === null ? completed : failedStage(outcome.failure);
};

const readDiagFolders = (
  run: DiagRun,
  samples: readonly BenchSample[],
  scenario: readonly ScenarioPassResult[],
): { readonly processes: readonly DiagProcess[]; readonly problems: readonly BenchError[] } => {
  const problems: BenchError[] = [];
  const diagRounds = [
    ...new Set(samples.filter((sample) => sample.build === 'darkstart-diag').map((sample) => sample.round)),
  ];
  const processes = readProcesses(
    [
      { group: 'check', folder: join(run.diagFolder, 'check') },
      ...diagRounds.map((diagRound) => ({ group: 'rounds' as const, folder: run.roundFolder(diagRound) })),
      ...scenario.map((result) => ({
        group: result.pass === 'clean' ? ('scenario clean' as const) : ('scenario planted' as const),
        folder: join(run.diagFolder, `scenario-${result.pass}`),
      })),
    ],
    problems,
  );
  return { processes, problems };
};

const writeDiagFiles = (
  run: DiagRun,
  stage: Stage,
  samples: readonly BenchSample[],
  summary: ReturnType<typeof summarize>,
  readout: Parameters<typeof writeReadout>[1],
): boolean => {
  try {
    if (!options.check) {
      writeRunFiles(run.runDirectory, {
        id: run.id,
        status: stage.ending.status,
        startedAt: isoSeconds(run.startedAt),
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
          diag: true,
        },
        conforming: run.found.length === 0,
        deviations: run.found,
        machine: { ...run.machine, loadAverageEnd: loadAverage() },
        software: run.software,
        samples,
        summary,
        verdict: decideVerdict(stage.ending, run.found, samples, summary, true),
        warnings,
      });
    }
    writeReadout(run.diagFolder, readout);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === null) {
      throw error;
    }
    err(`error: cannot write the run's files in ${displayPath(run.runDirectory)}/: ${code}.`);
    return false;
  }
};

const runDiag = async (packages: Packages): Promise<never> => {
  requireRecorderBuild();
  const token = `dscanary${randomBytes(16).toString('hex')}`;
  const run = prepareDiagRun(packages);
  await checkDiagBuilds(run);
  const samples: BenchSample[] = [];
  const measured = await measureDiagBuilds(run, samples);
  let stage = measured;
  let scenario: readonly ScenarioPassResult[] = [];
  if (measured.ending.status === 'complete') {
    const outcome = await runScenario(run.diagFolder, token, options.check ? 3 : 4);
    scenario = outcome.results;
    stage = scenarioStage(outcome);
  }

  const { processes, problems } = readDiagFolders(run, samples, scenario);
  const [problem] = problems;
  if (stage.failure === null && problem !== undefined) {
    stage = failedStage(problem);
  }
  for (const text of [
    ...scenario.flatMap((result) => result.warnings),
    ...problems.map((error) => `could not read a recorder folder: ${error.message}`),
    ...recorderWarnings(processes, run.software.revision),
  ]) {
    warn(text);
  }

  const summary = summarize(samples, options.servers, options.routes);
  const overhead = decideOverhead(summary, options, notAssessedReason(measured.ending, run.found, samples));
  const security = decideSecurity(
    processes,
    scenario,
    stage.ending.status === 'complete' ? null : notAssessedReason(stage.ending, [], []),
  );
  const written = writeDiagFiles(run, stage, samples, summary, {
    runId: run.id,
    revision: run.software.revision,
    node: process.version,
    sampling: options,
    overhead,
    measured: measuredWindows(samples, processes, run.roundFolder),
    processes,
    findings: security.findings,
    scenario,
    security: security.sentence,
    warnings,
  });

  for (const line of diagSummaryLines(
    summary,
    overheadSentence(overhead),
    security.sentence,
    readoutPath(run.diagFolder),
  )) {
    out(line);
  }
  if (stage.failure !== null) {
    printError(stage.failure);
  }
  if (stage.ending.status === 'interrupted') {
    err(`Interrupted. Servers stopped; the partial readout is in ${displayPath(readoutPath(run.diagFolder))}.`);
  }
  process.exit(diagExitCode(security.findings.length, stage.failure, stage.ending, written));
};

const runMode = (packages: Packages): Promise<never> => {
  if (options.diag) {
    return runDiag(packages);
  }
  return options.check ? runCheckMode() : runMeasure(packages);
};

try {
  refuseConditions();
  const inherited = inheritedDiagVariables();
  if (inherited.length > 0) {
    warn(inheritedDiagWarning(inherited));
  }
  const packages = resolvePackages();
  await runMode(packages);
} catch (error) {
  if (error instanceof BenchError) {
    printError(error);
    process.exit(error.exitCode);
  }
  throw error;
}
