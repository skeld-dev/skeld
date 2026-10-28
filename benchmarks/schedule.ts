import type { RunOptions, ServerId, Visit } from './types.ts';

function roundOrder(servers: readonly ServerId[], round: number): readonly ServerId[] {
  const shift = (round - 1) % servers.length;
  return [...servers.slice(shift), ...servers.slice(0, shift)];
}

export function scheduleVisits(options: RunOptions): readonly Visit[] {
  return Array.from({ length: options.rounds }, (_, index) => index + 1).flatMap((round) =>
    roundOrder(options.servers, round).map((server, index) => ({ round, position: index + 1, server })),
  );
}

export function estimatedMinutes(options: RunOptions): number {
  const seconds = options.rounds * options.servers.length * (options.routes.length * 2 * options.durationSeconds + 1);
  return Math.ceil(seconds / 60);
}
