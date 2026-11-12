// Does:  Creates the node:http server with every limit written out, and wraps its listen and close.
// Holds: No timeout or size limit is left to Node's default, and insecureHTTPParser is always off.

import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getSystemErrorMessage } from 'node:util';
import { end, event, listening, start, track } from '#diag';
import { BootError } from './boot-error.ts';
import type { HttpServerHandle, ListeningAddress, ResolvedServerOptions } from './types.ts';

const CHECKS_PER_HEADERS_TIMEOUT = 10;
const MIN_CHECKING_INTERVAL_MS = 1_000;
const MAX_CHECKING_INTERVAL_MS = 30_000;

// Does:  Returns how often Node checks the request timeouts: a tenth of headersTimeout, from one to thirty seconds.
// Holds: A stalled request is answered within one interval of its timeout.
function connectionsCheckingInterval(headersTimeout: number): number {
  return Math.min(
    MAX_CHECKING_INTERVAL_MS,
    Math.max(MIN_CHECKING_INTERVAL_MS, Math.floor(headersTimeout / CHECKS_PER_HEADERS_TIMEOUT)),
  );
}

function hostPort(host: string, port: number): string {
  // Why: An IPv6 literal needs brackets before a port.
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

function listenFailure(host: string, port: number, error: NodeJS.ErrnoException): BootError {
  const reason =
    error.code !== undefined && error.errno !== undefined
      ? `${error.code} (${getSystemErrorMessage(error.errno)})`
      : error.message;
  return new BootError('LISTEN_FAILED', `Cannot listen on ${hostPort(host, port)}: ${reason}`, null, null, {
    cause: error,
  });
}

function toListeningAddress(address: AddressInfo): ListeningAddress {
  return {
    host: address.address,
    port: address.port,
    url: `http://${hostPort(address.address, address.port)}`,
  };
}

export function createHttpServer(options: ResolvedServerOptions, onRequest: RequestListener): HttpServerHandle {
  const server = createServer(
    {
      requestTimeout: options.requestTimeout,
      headersTimeout: options.headersTimeout,
      connectionsCheckingInterval: connectionsCheckingInterval(options.headersTimeout),
      keepAliveTimeout: options.keepAliveTimeout,
      maxHeaderSize: options.maxHeaderSize,
      insecureHTTPParser: false,
    },
    onRequest,
  );
  return {
    listen(host, port, signal) {
      const { promise, resolve, reject } = Promise.withResolvers<ListeningAddress>();
      const span = start('boot.listen');
      let settled = false;
      const finish = (): boolean => {
        if (settled) {
          return false;
        }
        settled = true;
        end(span);
        server.off('error', onError);
        signal.removeEventListener('abort', onAbort);
        return true;
      };
      const onError = (error: NodeJS.ErrnoException): void => {
        if (finish()) {
          reject(listenFailure(host, port, error));
        }
      };
      const onAbort = (): void => {
        if (finish()) {
          reject(new BootError('SERVER_CLOSED', 'Server closed while binding', null, null));
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return promise;
      }
      server.once('error', onError);
      try {
        server.listen({ host, port, signal }, () => {
          if (!finish()) {
            return;
          }
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(
              new BootError('LISTEN_FAILED', `Cannot listen on ${hostPort(host, port)}: no TCP address`, null, null),
            );
            return;
          }
          listening(server);
          resolve(toListeningAddress(address));
        });
      } catch (cause) {
        if (finish()) {
          reject(new BootError('LISTEN_FAILED', `Cannot listen on ${hostPort(host, port)}`, null, null, { cause }));
        }
      }
      return promise;
    },
    close(timeoutMs) {
      const { promise, resolve } = Promise.withResolvers<void>();
      const span = track('close.total');
      // Why: In-flight requests get closeTimeoutMs to finish before every remaining connection is cut.
      const timer = setTimeout(() => {
        event('close.forced');
        server.closeAllConnections();
      }, timeoutMs);
      server.close(() => {
        clearTimeout(timer);
        end(span);
        resolve();
      });
      // Why: server.close stops accepting but leaves idle keep-alive sockets open, so they are closed at once.
      server.closeIdleConnections();
      return promise;
    },
  };
}
