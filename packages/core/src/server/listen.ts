import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getSystemErrorMessage } from 'node:util';
import { closed, end, event, listening, start, track } from '#diag';
import { BootError } from './boot-error.ts';
import type { HttpServerHandle, ListeningAddress, ResolvedServerOptions } from './types.ts';

function hostPort(host: string, port: number): string {
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
      keepAliveTimeout: options.keepAliveTimeout,
      maxHeaderSize: options.maxHeaderSize,
      insecureHTTPParser: false,
    },
    onRequest,
  );
  return {
    listen(host, port) {
      const { promise, resolve, reject } = Promise.withResolvers<ListeningAddress>();
      const span = start('boot.listen');
      const onError = (error: NodeJS.ErrnoException): void => {
        end(span);
        reject(listenFailure(host, port, error));
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        end(span);
        server.off('error', onError);
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
      return promise;
    },
    close(timeoutMs) {
      const { promise, resolve } = Promise.withResolvers<void>();
      const span = track('close.total');
      const timer = setTimeout(() => {
        event('close.forced');
        server.closeAllConnections();
      }, timeoutMs);
      server.close(() => {
        clearTimeout(timer);
        end(span);
        closed();
        resolve();
      });
      server.closeIdleConnections();
      return promise;
    },
  };
}
