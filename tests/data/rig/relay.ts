// Does:  Runs a loopback relay in front of PostgreSQL 19 in one of three modes: observe, downgrade or strip.
// Holds: A connection's record is its own; bytes pass unchanged except the rewrites a mode names; nothing is printed.

import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect, createSecureContext, type SecureContext, TLSSocket } from 'node:tls';

export type RelayMode = 'observe' | 'downgrade' | 'strip';

export interface RelayConnection {
  readonly id: number;
  firstBytes: Buffer;
  toServer: number;
  toClient: number;
  backendKeyBytes: number[];
  cancelKeyBytes: number[];
  messageTypes: string[];
  error: string | null;
}

export interface Relay {
  readonly port: number;
  readonly caFile: string | null;
  readonly connections: readonly RelayConnection[];
  mark: () => void;
  close: () => Promise<void>;
}

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_3_0 = 196608;
const SASL_REQUEST = 10;
const BINDING_MECHANISM = 'SCRAM-SHA-256-PLUS';
const MAX_MESSAGE = 64 * 1024 * 1024;
const MAX_STARTUP = 10_000;
const FOLDER_PREFIX = 'skeld-data-relay-';

interface Upstream {
  readonly host: string;
  readonly port: number;
  readonly caFile: string;
}

interface Authority {
  readonly dir: string;
  readonly caFile: string;
  readonly context: SecureContext;
}

function upstreamFromEnvironment(): Upstream {
  const text = process.env.SKELD_TEST_PG19_URL;
  const caFile = process.env.SKELD_TEST_PG19_CA;
  if (text === undefined || text === '') {
    throw new Error('SKELD_TEST_PG19_URL is not set');
  }
  if (caFile === undefined || caFile === '') {
    throw new Error('SKELD_TEST_PG19_CA is not set');
  }
  const url = new URL(text);
  return { host: url.hostname, port: Number(url.port), caFile };
}

function openssl(...args: string[]): void {
  execFileSync('openssl', args, { stdio: 'ignore' });
}

function makeAuthority(): Authority {
  const dir = mkdtempSync(join(tmpdir(), FOLDER_PREFIX));
  const file = (name: string): string => join(dir, name);
  const curve = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  openssl(
    ...['req', '-x509', ...curve, '-keyout', file('ca.key'), '-out', file('ca.pem'), '-days', '2'],
    ...['-subj', '/CN=Skeld relay authority', '-addext', 'basicConstraints=critical,CA:TRUE'],
    ...['-addext', 'keyUsage=critical,keyCertSign'],
  );
  writeFileSync(
    file('relay.ext'),
    ['subjectAltName=DNS:localhost,IP:127.0.0.1', 'extendedKeyUsage=serverAuth', ''].join('\n'),
  );
  openssl('req', '-new', ...curve, '-keyout', file('relay.key'), '-out', file('relay.csr'), '-subj', '/CN=localhost');
  openssl(
    ...['x509', '-req', '-in', file('relay.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key')],
    ...['-CAcreateserial', '-out', file('relay.pem'), '-extfile', file('relay.ext'), '-days', '2'],
  );
  const context = createSecureContext({ key: readFileSync(file('relay.key')), cert: readFileSync(file('relay.pem')) });
  // Why: Nothing after this signs or serves from a file, so both private keys leave the disk now.
  unlinkSync(file('ca.key'));
  unlinkSync(file('relay.key'));
  return { dir, caFile: file('ca.pem'), context };
}

// Does:  Resolves with exactly size bytes from a stream held in paused mode, or rejects when it ends first.
function readExactly(stream: Duplex, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      stream.off('readable', attempt);
      stream.off('end', fail);
      stream.off('close', fail);
      stream.off('error', reject);
    };
    const fail = (): void => {
      cleanup();
      reject(new Error('the stream closed before the message was complete'));
    };
    const attempt = (): void => {
      const chunk: Buffer | null = stream.read(size);
      if (chunk === null) {
        return;
      }
      cleanup();
      if (chunk.length === size) {
        resolve(chunk);
      } else {
        reject(new Error('the stream ended inside a message'));
      }
    };
    stream.on('readable', attempt);
    stream.once('end', fail);
    stream.once('close', fail);
    stream.once('error', reject);
    attempt();
  });
}

// Does:  Splits a stream of typed PostgreSQL messages (type byte, length, body) into whole messages.
class Framer {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const messages: Buffer[] = [];
    while (this.pending.length >= 5) {
      const length = this.pending.readInt32BE(1);
      if (length < 4 || length > MAX_MESSAGE) {
        throw new Error('a message length was outside the relay bounds');
      }
      if (this.pending.length < length + 1) {
        break;
      }
      messages.push(this.pending.subarray(0, length + 1));
      this.pending = this.pending.subarray(length + 1);
    }
    return messages;
  }
}

function withoutBinding(message: Buffer): Buffer {
  if (message[0] !== 0x52 || message.length < 9 || message.readInt32BE(5) !== SASL_REQUEST) {
    return message;
  }
  const names = message
    .subarray(9, message.length - 1)
    .toString('latin1')
    .split('\0')
    .filter((name) => name !== '' && name !== BINDING_MECHANISM);
  const list = Buffer.from(`${names.map((name) => `${name}\0`).join('')}\0`, 'latin1');
  const head = Buffer.alloc(9);
  head.write('R', 0, 'latin1');
  head.writeInt32BE(8 + list.length, 1);
  head.writeInt32BE(SASL_REQUEST, 5);
  return Buffer.concat([head, list]);
}

// Why: PostgreSQL 19.0 sends the whole version number (3.2 as 0x00030002), not the minor alone.
function negotiateProtocolVersion(): Buffer {
  const message = Buffer.alloc(13);
  message.write('v', 0, 'latin1');
  message.writeInt32BE(12, 1);
  message.writeInt32BE(PROTOCOL_3_0, 5);
  message.writeInt32BE(0, 9);
  return message;
}

export async function startRelay(mode: RelayMode): Promise<Relay> {
  const upstream = upstreamFromEnvironment();
  const authority = mode === 'observe' ? null : makeAuthority();
  const connections: RelayConnection[] = [];
  const sockets = new Set<Socket>();
  let marked = false;

  const entryOf = new WeakMap<Socket, RelayConnection>();
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  const fail = (entry: RelayConnection, error: unknown): void => {
    entry.error ??= error instanceof Error ? error.message : String(error);
    for (const socket of sockets) {
      if (entryOf.get(socket) === entry) {
        socket.destroy();
      }
    }
  };
  const adopt = (socket: Socket, entry: RelayConnection): void => {
    entryOf.set(socket, entry);
    track(socket);
    socket.on('error', (error) => fail(entry, error));
  };

  const forward = (from: Socket, to: Socket, entry: RelayConnection, tap: (chunk: Buffer) => Buffer | null): void => {
    from.on('data', (chunk: Buffer) => {
      let out: Buffer | null;
      try {
        out = tap(chunk);
      } catch (error) {
        fail(entry, error);
        return;
      }
      if (out === null || out.length === 0) {
        return;
      }
      if (!to.write(out)) {
        from.pause();
        to.once('drain', () => from.resume());
      }
    });
    from.once('end', () => to.end());
    from.once('close', () => to.destroy());
    // Why: A stream that was read through 'readable' stays paused until it is resumed after the data listener.
    from.resume();
  };

  const wire = (client: Socket, server: Socket, entry: RelayConnection): void => {
    const framer = new Framer();
    forward(client, server, entry, (chunk) => {
      if (marked) {
        entry.toServer += chunk.length;
      }
      return chunk;
    });
    forward(server, client, entry, (chunk) => {
      if (mode === 'observe') {
        if (marked) {
          entry.toClient += chunk.length;
        }
        return chunk;
      }
      const messages = framer.push(chunk);
      for (const message of messages) {
        if (message[0] === 0x4b) {
          entry.backendKeyBytes.push(message.readInt32BE(1) - 8);
        }
        if (marked) {
          entry.messageTypes.push(String.fromCharCode(message[0] ?? 0));
        }
      }
      const out = mode === 'strip' ? Buffer.concat(messages.map(withoutBinding)) : chunk;
      if (marked) {
        entry.toClient += out.length;
      }
      return out;
    });
  };

  const openUpstream = async (entry: RelayConnection): Promise<Socket> => {
    const plain = connect({ host: upstream.host, port: upstream.port });
    adopt(plain, entry);
    await once(plain, 'connect');
    if (mode === 'downgrade') {
      return plain;
    }
    const request = Buffer.alloc(8);
    request.writeInt32BE(8, 0);
    request.writeInt32BE(SSL_REQUEST, 4);
    plain.write(request);
    const answer = await readExactly(plain, 1);
    if (answer.toString('latin1') !== 'S' || plain.readableLength !== 0) {
      throw new Error('PostgreSQL did not accept the relay TLS request');
    }
    const secure = tlsConnect({ socket: plain, ca: readFileSync(upstream.caFile), host: upstream.host });
    adopt(secure, entry);
    await once(secure, 'secureConnect');
    return secure;
  };

  const terminate = async (client: Socket, entry: RelayConnection): Promise<void> => {
    if (authority === null) {
      throw new Error('a mode with no authority has no TLS to end');
    }
    const first = await readExactly(client, 8);
    entry.firstBytes = Buffer.from(first);
    if (first.readUInt32BE(0) !== 8 || first.readUInt32BE(4) !== SSL_REQUEST) {
      throw new Error('the first message was not a TLS request');
    }
    if (client.readableLength !== 0) {
      throw new Error('bytes followed the TLS request');
    }
    client.write('S');
    const secure = new TLSSocket(client, {
      isServer: true,
      secureContext: authority.context,
      ALPNProtocols: ['postgresql'],
    });
    adopt(secure, entry);
    await once(secure, 'secure');

    const head = await readExactly(secure, 4);
    const length = head.readUInt32BE(0);
    if (length < 8 || length > MAX_STARTUP) {
      throw new Error('the startup length was outside the relay bounds');
    }
    const message = Buffer.concat([head, await readExactly(secure, length - 4)]);
    const code = message.readUInt32BE(4);
    if (code === CANCEL_REQUEST) {
      entry.cancelKeyBytes.push(length - 12);
    } else if (code >>> 16 !== 3) {
      throw new Error('the startup was neither protocol 3 nor a cancel request');
    } else if (mode === 'downgrade' && (code & 0xffff) !== 0) {
      secure.write(negotiateProtocolVersion());
      message.writeUInt32BE(PROTOCOL_3_0, 4);
    }
    const server = await openUpstream(entry);
    server.write(message);
    wire(secure, server, entry);
  };

  const serve = (client: Socket): void => {
    const entry: RelayConnection = {
      id: connections.length + 1,
      firstBytes: Buffer.alloc(0),
      toServer: 0,
      toClient: 0,
      backendKeyBytes: [],
      cancelKeyBytes: [],
      messageTypes: [],
      error: null,
    };
    connections.push(entry);
    adopt(client, entry);
    if (mode === 'observe') {
      const server = connect({ host: upstream.host, port: upstream.port });
      adopt(server, entry);
      wire(client, server, entry);
      client.on('data', (chunk: Buffer) => {
        if (entry.firstBytes.length < 8) {
          entry.firstBytes = Buffer.concat([entry.firstBytes, chunk]).subarray(0, 8);
        }
      });
      return;
    }
    terminate(client, entry).catch((error: unknown) => fail(entry, error));
  };

  const listener = createServer(serve);
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the relay has no port');
  }

  return {
    port: address.port,
    caFile: authority === null ? null : authority.caFile,
    connections,
    mark: () => {
      marked = true;
      for (const entry of connections) {
        entry.toServer = 0;
        entry.toClient = 0;
        entry.messageTypes = [];
      }
    },
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      if (authority !== null) {
        rmSync(authority.dir, { recursive: true, force: true });
      }
    },
  };
}
