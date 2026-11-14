// Does:  Builds the list of visits: every entrant once per round, in an order rotated each round.
// Holds: Each entrant is measured once per round, and multiple entrants rotate positions each round.

import type { BuildId, LoggingBuildId, LoggingSession, RunOptions, Visit } from './types.ts';

interface Entrant {
  readonly server: string;
  readonly build: BuildId;
}

const diagBuilds: readonly BuildId[] = ['skeld', 'skeld-diag'];
const controlBuilds: readonly LoggingBuildId[] = ['before-a', 'before-b'];
export const loggingBuilds: readonly LoggingBuildId[] = [...controlBuilds, 'off', 'default', 'access'];

export const sessionBuilds = (session: LoggingSession): readonly LoggingBuildId[] =>
  session.controlOnly ? controlBuilds : loggingBuilds;

function roundOrder<T>(order: readonly T[], round: number): readonly T[] {
  const shift = (round - 1) % order.length;
  return [...order.slice(shift), ...order.slice(0, shift)];
}

const entrants = (options: RunOptions, external: string | null): readonly Entrant[] => {
  if (options.logging !== null) {
    return sessionBuilds(options.logging).map((build) => ({ server: 'skeld', build }));
  }
  if (options.diag) {
    return diagBuilds.map((build) => ({ server: 'skeld', build }));
  }
  const own = options.servers.map((server): Entrant => ({ server, build: 'skeld' }));
  return external === null ? own : [...own, { server: external, build: 'external' }];
};

export function scheduleVisits(options: RunOptions, external: string | null): readonly Visit[] {
  return Array.from({ length: options.rounds }, (_, index) => index + 1).flatMap((round) =>
    roundOrder(entrants(options, external), round).map((entrant, index) => ({
      round,
      position: index + 1,
      ...entrant,
    })),
  );
}

export function estimatedMinutes(options: RunOptions, external: string | null): number {
  const seconds =
    options.rounds *
    entrants(options, external).length *
    (options.routes.length * (options.warmUpSeconds + options.durationSeconds) + 1);
  return Math.ceil(seconds / 60);
}
