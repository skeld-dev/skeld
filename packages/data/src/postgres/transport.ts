// Does:  Opens the byte stream to a PostgreSQL server: the socket, the TLS request and the verified TLS handshake.
// Holds: Every handshake rejects an unverified chain and checks the URL's host; no setting turns either off.

import { connect as connectTcp, type Socket } from 'node:net';
import { checkServerIdentity, connect as connectTls, type TLSSocket } from 'node:tls';
import type { ConnectStage } from '../data-error/types.ts';
import type { Reason } from '../data-error/reason.ts';
import type { PostgresTarget } from './target.ts';
import { sslRequest } from './wire.ts';

// Why: Captured at load, so code that later replaces tls.checkServerIdentity cannot relax the host-name check.
const verifyHost = checkServerIdentity;

// Why: A path that dies silently is found after 60 s idle, the keepalive delay postgres-js ships.
const KEEPALIVE_MS = 60_000;

// Why: Each step reads failures through its own listener, later ones arrive as close; this stops an error throwing.
const ignore = (): void => undefined;

const S = 0x53;
const N = 0x4e;

export interface Transport {
  readonly socket: Socket;
  readonly stream: Socket | TLSSocket;
  readonly certificate: TLSSocket | null;
}

export class TransportFailure extends Error {
  readonly stage: ConnectStage;
  readonly reason: Reason;

  constructor(stage: ConnectStage, reason: Reason) {
    super('transport failed');
    this.stage = stage;
    this.reason = reason;
  }
}

function socketReason(error: unknown): Reason {
  const syscall = typeof error === 'object' && error !== null && 'syscall' in error ? error.syscall : null;
  return syscall === 'getaddrinfo' ? 'resolve' : 'connect';
}

function openSocket(host: string, port: number, signal: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host, port, noDelay: true, keepAlive: true, keepAliveInitialDelay: KEEPALIVE_MS });
    socket.on('error', ignore);
    const fail = (failure: TransportFailure): void => {
      signal.removeEventListener('abort', abort);
      socket.removeListener('error', error);
      socket.destroy();
      reject(failure);
    };
    const abort = (): void => fail(new TransportFailure('socket', 'timeout'));
    const error = (cause: unknown): void => fail(new TransportFailure('socket', socketReason(cause)));
    socket.once('error', error);
    socket.once('connect', () => {
      signal.removeEventListener('abort', abort);
      socket.removeListener('error', error);
      resolve(socket);
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}

// Does:  Sends the TLS request and reads its one-byte answer with the socket paused, so nothing after it is consumed.
// Holds: Only a lone S continues; N, any other byte, or a second readable byte ends the attempt.
function requestTls(socket: Socket, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (failure: TransportFailure | null): void => {
      signal.removeEventListener('abort', abort);
      socket.removeListener('readable', readable);
      socket.removeListener('error', error);
      socket.removeListener('end', ended);
      if (failure === null) {
        resolve();
      } else {
        socket.destroy();
        reject(failure);
      }
    };
    const abort = (): void => settle(new TransportFailure('tls', 'timeout'));
    const error = (): void => settle(new TransportFailure('tls', 'closed'));
    const ended = (): void => settle(new TransportFailure('tls', 'closed'));
    const readable = (): void => {
      const answer: Buffer | null = socket.read(1);
      if (answer === null) {
        return;
      }
      const byte = answer.readUInt8(0);
      if (byte === N) {
        settle(new TransportFailure('tls', 'declined'));
      } else if (byte !== S || socket.readableLength > 0) {
        // Why: Bytes after S before the handshake are a buffer-stuffing attempt (protocol-flow, CVE-2021-23222).
        settle(new TransportFailure('tls', 'answer'));
      } else {
        settle(null);
      }
    };
    socket.on('readable', readable);
    socket.once('error', error);
    socket.once('end', ended);
    signal.addEventListener('abort', abort, { once: true });
    socket.write(sslRequest());
  });
}

// Why: The codes Node gives a certificate that fails chain verification (doc/api/tls.md, the verification error list).
const CERTIFICATE_CODES: ReadonlySet<unknown> = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_CRL',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
  'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
  'CERT_SIGNATURE_FAILURE',
  'CRL_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CRL_NOT_YET_VALID',
  'CRL_HAS_EXPIRED',
  'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD',
  'ERROR_IN_CRL_LAST_UPDATE_FIELD',
  'ERROR_IN_CRL_NEXT_UPDATE_FIELD',
  'OUT_OF_MEM',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_CHAIN_TOO_LONG',
  'CERT_REVOKED',
  'INVALID_CA',
  'PATH_LENGTH_EXCEEDED',
  'INVALID_PURPOSE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'HOSTNAME_MISMATCH',
]);

function tlsReason(cause: unknown): Reason {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null;
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return 'hostname';
  }
  return CERTIFICATE_CODES.has(code) ? 'certificate' : 'handshake';
}

function handshake(socket: Socket, target: PostgresTarget, signal: AbortSignal): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    // Why: With neither servername nor host Node checks the name localhost, so the URL's host is always named.
    const identity = target.address ? { host: target.host } : { servername: target.host };
    const secure = connectTls({
      socket,
      ...identity,
      rejectUnauthorized: true,
      checkServerIdentity: verifyHost,
      ...(target.ca === null ? {} : { ca: [...target.ca] }),
      ALPNProtocols: ['postgresql'],
    });
    secure.on('error', ignore);
    const fail = (failure: TransportFailure): void => {
      signal.removeEventListener('abort', abort);
      secure.removeListener('error', error);
      secure.removeListener('close', closed);
      secure.destroy();
      socket.destroy();
      reject(failure);
    };
    const abort = (): void => fail(new TransportFailure('tls', 'timeout'));
    const error = (cause: unknown): void => fail(new TransportFailure('tls', tlsReason(cause)));
    const closed = (): void => fail(new TransportFailure('tls', 'handshake'));
    secure.once('error', error);
    secure.once('close', closed);
    secure.once('secureConnect', () => {
      signal.removeEventListener('abort', abort);
      secure.removeListener('error', error);
      secure.removeListener('close', closed);
      resolve(secure);
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}

// Does:  Opens a transport to the given host and port, naming the target's host in the TLS handshake.
export async function openTransport(
  host: string,
  port: number,
  target: PostgresTarget,
  signal: AbortSignal,
): Promise<Transport> {
  if (signal.aborted) {
    throw new TransportFailure('socket', 'timeout');
  }
  const socket = await openSocket(host, port, signal);
  if (target.transport === 'plaintext') {
    return { socket, stream: socket, certificate: null };
  }
  await requestTls(socket, signal);
  const secure = await handshake(socket, target, signal);
  return { socket, stream: secure, certificate: secure };
}
