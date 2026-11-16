// Does:  Holds the grant a request's authorize step admitted and releases it when the request stops running.
// Holds: Each grant core received is released once: at the reply, a final state, the deadline or the connection close.

import type { Exchange } from './exchange.ts';
import { pointHookFailed } from './points.ts';

function callRelease(exchange: Exchange, release: (grant: unknown) => unknown, grant: unknown): void {
  try {
    release(grant);
  } catch (error) {
    pointHookFailed(exchange, 'internal', error);
  }
}

// Does:  Keeps an admitted grant on its running request until releaseGrant or the connection's close ends it.
export function holdGrant(exchange: Exchange, grant: unknown): void {
  exchange.grant = grant;
  const release = exchange.route.gate?.release ?? null;
  if (release === null) {
    return;
  }
  exchange.release = release;
  exchange.res.once('close', () => releaseGrant(exchange));
}

// Does:  Releases the grant a request holds, at most once; a request without one is left as it is.
export function releaseGrant(exchange: Exchange): void {
  const { release } = exchange;
  if (release === null) {
    return;
  }
  exchange.release = null;
  callRelease(exchange, release, exchange.grant);
}

// Does:  Releases at once a grant whose outcome arrived after its request stopped running.
export function releaseLateGrant(exchange: Exchange, grant: unknown): void {
  const release = exchange.route.gate?.release ?? null;
  if (release !== null) {
    callRelease(exchange, release, grant);
  }
}
