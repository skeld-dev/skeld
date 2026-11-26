// Does:  Boots a server with a PostgreSQL pool through the public API and reports what a failed boot said.
// Holds: A failed boot is returned as data with its stage, reason and every text it could carry; it is never thrown.

import { BootError } from '@skeld/core/boot-error';
import { Secret } from '@skeld/core/secret';
import { createServer } from '@skeld/core/server';
import type { Database } from '@skeld/data/database';
import { createPostgresDatabase, type PostgresOptions } from '@skeld/data/postgres';

export type PoolBounds = Pick<
  PostgresOptions,
  | 'maxConnections'
  | 'maxWaiters'
  | 'acquireTimeoutMs'
  | 'connectTimeoutMs'
  | 'maxLifetimeMs'
  | 'maxResultBytes'
  | 'maxParameterBytes'
>;

export interface BootOptions {
  readonly ca?: string;
  readonly channelBinding?: 'when-offered' | 'required';
  readonly bounds?: PoolBounds;
}

export interface BootFailure {
  readonly code: string;
  readonly plugin: string | null;
  readonly message: string;
  readonly stage: string | null;
  readonly reason: string | null;
  readonly everything: string;
}

export type BootedServer = ReturnType<typeof createServer>;

export interface Booted {
  readonly server: BootedServer;
  readonly database: Database | null;
  readonly failure: BootFailure | null;
  finish: () => Promise<string[]>;
}

function chain(error: unknown): string {
  const parts: string[] = [];
  let at: unknown = error;
  for (let depth = 0; depth < 8 && at !== undefined && at !== null; depth += 1) {
    if (at instanceof Error) {
      parts.push(at.message, at.stack ?? '', JSON.stringify(at, Object.getOwnPropertyNames(at)));
      at = at.cause;
    } else {
      parts.push(String(at));
      at = undefined;
    }
  }
  return parts.join('\n');
}

function failureOf(error: unknown): BootFailure {
  const message = error instanceof Error ? error.message : String(error);
  const found = /Database connection failed at (\w+) \(([\w-]+)\)/.exec(message);
  return {
    code: error instanceof BootError ? error.code : 'NOT_A_BOOT_ERROR',
    plugin: error instanceof BootError ? error.plugin : null,
    message,
    stage: found?.[1] ?? null,
    reason: found?.[2] ?? null,
    everything: chain(error),
  };
}

export async function bootPool(url: string, options: BootOptions = {}): Promise<Booted> {
  const lines: string[] = [];
  const server = createServer({
    log: {
      sink: (batch: readonly string[]) => {
        lines.push(...batch);
      },
    },
  });
  let database: Database | null = null;
  let failure: BootFailure | null = null;
  try {
    const tls = {
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      ...(options.channelBinding === undefined ? {} : { channelBinding: options.channelBinding }),
    };
    database = createPostgresDatabase({ url: new Secret(url), tls, ...(options.bounds ?? {}) });
    server.register(database.plugin, { name: 'database' });
    await server.listen({ port: 0 });
  } catch (error) {
    failure = failureOf(error);
  }
  return {
    server,
    database,
    failure,
    finish: async () => {
      await server.close();
      return lines;
    },
  };
}
