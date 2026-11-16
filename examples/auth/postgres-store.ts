// The auth store on PostgreSQL, over the application's own pg Pool. The rest of this example runs on SQLite.
//
// What the application owns:
// - The Pool and its lifetime. The store checks out at most maxClients of its clients (default half of max) and
//   never ends it: the application ends it after the store is closed.
// - connectionTimeoutMillis of 5,000 ms or less. pg waits for a connection without limit by default, and the store
//   keeps a slot for every connect that has not settled.
// - One primary with durable commits. Without them, a revocation auth saw committed can be lost.
// - store.install(), run once by the application's own setup step before the service starts, not at every start.
//
// Creating the Pool and the store connects to nothing, so this file runs without a database.

import { createPostgresStore } from '@skeld/auth/postgres';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: 'postgres://app@127.0.0.1:5432/app',
  max: 10,
  connectionTimeoutMillis: 5_000,
});

// Give this store to createAuth({ store, origin }); the server's listen attaches it.
const store = createPostgresStore({ pool, maxClients: 5 });

await store.close();
await pool.end();
process.stdout.write('created and closed a PostgreSQL auth store; no connection was made\n');
