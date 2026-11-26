// Does:  Declares what stands behind a database: its engine, its pool and, once its plugin ran, its events.
// Holds: The engine and the pool hold sessions of the same kind, chosen by the engine's name.

import type { DataEvents } from '../events/types.ts';
import type { Pool } from '../pool/types.ts';
import type { PostgresConnection } from '../postgres/connection-types.ts';
import type { Engine, Session } from '../session/types.ts';

export type DatabaseInternals =
  | {
      readonly engine: Engine<PostgresConnection> & { readonly name: 'postgres' };
      readonly pool: Pool<PostgresConnection>;
      readonly events: DataEvents | null;
    }
  | {
      readonly engine: Engine<Session> & { readonly name: 'sqlite' };
      readonly pool: Pool<Session>;
      readonly events: DataEvents | null;
    };
