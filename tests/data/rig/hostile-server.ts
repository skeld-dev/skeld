// Does:  Starts loopback fixture servers that speak only as much PostgreSQL protocol as one hostile case needs.
// Holds: Every byte a client sends is recorded per connection; a fixture sends nothing its mode does not name.

import { execFileSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { createSecureContext, type SecureContext, TLSSocket } from 'node:tls';

export type Hostile = 'oversized-length' | 'field-below-minus-one' | 'field-past-message';

export interface SessionTail {
  key?: 'none' | number;
  version?: '3.2' | '3.0';
  hostileAt?: number;
  hostile?: Hostile;
  declaredLength?: number;
}

export type HostileConfig =
  | { mode: 'tls-n' }
  | { mode: 'tls-extra'; extra?: number }
  | { mode: 'tls-error' }
  | { mode: 'self-signed' }
  | { mode: 'wrong-host' }
  | { mode: 'alpn-other' }
  | { mode: 'cleartext' }
  | { mode: 'md5' }
  | ({ mode: 'auth-ok' } & SessionTail)
  | ({
      mode: 'scram';
      password: string;
      wrongSignature?: boolean;
      iterations?: number;
      mechanisms?: readonly ('SCRAM-SHA-256-PLUS' | 'SCRAM-SHA-256')[];
    } & SessionTail);

export interface FrontMessage {
  readonly type: string;
  readonly body: Buffer;
}

export interface HostileConnection {
  readonly id: number;
  raw: Buffer;
  received: Buffer;
  messages: FrontMessage[];
  handshake: 'none' | 'completed';
  alpn: string | false | null;
  tlsError: string | null;
  startupVersion: number | null;
  negotiated: boolean;
  scram: { mechanism: string; flag: string; iterations: number; proofVerified: boolean | null } | null;
  cycles: number;
  hostileWritten: number;
  hostileCapped: boolean;
  closed: boolean;
}

export interface HostileServer {
  readonly port: number;
  readonly ca: string;
  readonly marker: string;
  readonly connections: readonly HostileConnection[];
  closed: (index: number) => Promise<void>;
  close: () => Promise<void>;
}

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_3_0 = 196608;
const WRITE_CAP = 256 * 1024 * 1024;
const CHUNK = 65_536;
const FOLDER_PREFIX = 'skeld-data-hostile-';

function int32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeInt32BE(value);
  return out;
}

function int16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeInt16BE(value);
  return out;
}

function cstring(text: string): Buffer {
  return Buffer.from(`${text}\0`, 'utf8');
}

function message(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type, 'latin1'), int32(4 + body.length), body]);
}

function authRequest(code: number, ...parts: Buffer[]): Buffer {
  return message('R', int32(code), ...parts);
}

function errorResponse(severity: string, state: string, text: string): Buffer {
  return message(
    'E',
    Buffer.from('S'),
    cstring(severity),
    Buffer.from('C'),
    cstring(state),
    Buffer.from('M'),
    cstring(text),
    Buffer.from([0]),
  );
}

function rowDescription(): Buffer {
  const field = Buffer.concat([cstring('?column?'), int32(0), int16(0), int32(23), int16(4), int32(-1), int16(0)]);
  return message('T', int16(1), field);
}

function dataRow(): Buffer {
  return message('D', int16(1), int32(1), Buffer.from('1'));
}

function readyForQuery(): Buffer {
  return message('Z', Buffer.from('I'));
}

function negotiateProtocolVersion(): Buffer {
  return message('v', int32(PROTOCOL_3_0), int32(0));
}

interface Authority {
  readonly ca: string;
  readonly leaf: SecureContext;
}

// Why: A key never reaches disk past this call: each file is read into memory and the folder is removed at once.
function makeAuthority(leaf: 'good' | 'wrong-host' | 'self-signed'): Authority {
  const dir = mkdtempSync(join(tmpdir(), FOLDER_PREFIX));
  try {
    const file = (name: string): string => join(dir, name);
    const openssl = (...args: string[]): void => {
      execFileSync('openssl', args, { stdio: 'ignore' });
    };
    const curve = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
    openssl(
      ...['req', '-x509', ...curve, '-keyout', file('ca.key'), '-out', file('ca.pem'), '-days', '2'],
      ...['-subj', '/CN=Skeld hostile fixture authority', '-addext', 'basicConstraints=critical,CA:TRUE'],
      ...['-addext', 'keyUsage=critical,keyCertSign'],
    );
    const names = leaf === 'wrong-host' ? 'DNS:elsewhere.test' : 'DNS:localhost,IP:127.0.0.1';
    if (leaf === 'self-signed') {
      openssl(
        ...['req', '-x509', ...curve, '-keyout', file('leaf.key'), '-out', file('leaf.pem'), '-days', '2'],
        ...['-subj', '/CN=localhost', '-addext', `subjectAltName=${names}`, '-addext', 'extendedKeyUsage=serverAuth'],
      );
    } else {
      writeFileSync(file('leaf.ext'), [`subjectAltName=${names}`, 'extendedKeyUsage=serverAuth', ''].join('\n'));
      openssl('req', '-new', ...curve, '-keyout', file('leaf.key'), '-out', file('leaf.csr'), '-subj', '/CN=localhost');
      openssl(
        ...['x509', '-req', '-in', file('leaf.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key')],
        ...['-CAcreateserial', '-out', file('leaf.pem'), '-extfile', file('leaf.ext'), '-days', '2'],
      );
    }
    return {
      ca: readFileSync(file('ca.pem'), 'utf8'),
      leaf: createSecureContext({ key: readFileSync(file('leaf.key')), cert: readFileSync(file('leaf.pem')) }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// Does:  Splits what a client sends after TLS into messages: one untyped startup message, then typed ones.
class FrontReader {
  private pending: Buffer = Buffer.alloc(0);
  private started = false;

  push(chunk: Buffer): FrontMessage[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const out: FrontMessage[] = [];
    for (;;) {
      const lead = this.started ? 1 : 0;
      if (this.pending.length < lead + 4) {
        return out;
      }
      const length = this.pending.readInt32BE(lead);
      if (length < 4 || this.pending.length < lead + length) {
        return out;
      }
      out.push({
        type: this.started ? String.fromCharCode(this.pending[0] ?? 0) : '',
        body: Buffer.from(this.pending.subarray(lead + 4, lead + length)),
      });
      this.pending = this.pending.subarray(lead + length);
      this.started = true;
    }
  }
}

function xor(a: Buffer, b: Buffer): Buffer {
  return Buffer.from(a.map((byte, i) => byte ^ (b[i] ?? 0)));
}

function hmac(key: Buffer, text: string | Buffer): Buffer {
  return createHmac('sha256', key).update(text).digest();
}

// Does:  Answers one client connection by the fixture's mode, after TLS where the mode has TLS.
class Session {
  private readonly reader = new FrontReader();
  private stage = 'startup';
  private serverFirst = '';
  private clientFirst = '';
  private salted: Buffer = Buffer.alloc(0);

  private readonly config: HostileConfig;
  private readonly tail: SessionTail;
  private readonly entry: HostileConnection;
  private readonly out: Duplex;
  private readonly shared: { cycles: number };

  constructor(
    config: HostileConfig,
    tail: SessionTail,
    entry: HostileConnection,
    out: Duplex,
    shared: { cycles: number },
  ) {
    this.config = config;
    this.tail = tail;
    this.entry = entry;
    this.out = out;
    this.shared = shared;
  }

  attach(): void {
    this.out.on('data', (chunk: Buffer) => {
      this.entry.received = Buffer.concat([this.entry.received, chunk]);
      for (const front of this.reader.push(chunk)) {
        this.entry.messages.push(front);
        this.handle(front);
      }
    });
  }

  private handle(front: FrontMessage): void {
    if (front.type === '') {
      this.startup(front);
    } else if (
      front.type === 'p' &&
      this.config.mode === 'scram' &&
      (this.stage === 'initial' || this.stage === 'final')
    ) {
      this.scram(this.config, front);
    } else if (front.type === 'p') {
      this.out.write(errorResponse('FATAL', '28P01', 'password authentication failed'));
      this.out.end();
    } else if (front.type === 'Q' || front.type === 'S') {
      this.answerCycle(front.type === 'S');
    } else if (front.type === 'X') {
      this.out.end();
    }
  }

  private startup(front: FrontMessage): void {
    const code = front.body.readUInt32BE(0);
    this.entry.startupVersion = code;
    if (code === CANCEL_REQUEST) {
      this.out.end();
      return;
    }
    if ((code & 0xffff) !== 0 && this.tail.version === '3.0') {
      this.out.write(negotiateProtocolVersion());
      this.entry.negotiated = true;
    }
    const mode = this.config.mode;
    if (mode === 'cleartext') {
      this.out.write(authRequest(3));
    } else if (mode === 'md5') {
      this.out.write(authRequest(5, randomBytes(4)));
    } else if (mode === 'auth-ok') {
      this.finishAuthentication();
    } else if (this.config.mode === 'scram') {
      const names = this.config.mechanisms ?? ['SCRAM-SHA-256-PLUS', 'SCRAM-SHA-256'];
      this.out.write(authRequest(10, ...names.map((name) => cstring(name)), Buffer.from([0])));
      this.stage = 'initial';
    }
  }

  private scram(config: Extract<HostileConfig, { mode: 'scram' }>, front: FrontMessage): void {
    if (this.stage === 'initial') {
      const end = front.body.indexOf(0);
      const first = front.body.subarray(end + 5).toString('utf8');
      const bare = first.slice(first.indexOf(',', first.indexOf(',') + 1) + 1);
      const iterations = config.iterations ?? 4096;
      const salt = randomBytes(16);
      const nonce = (/(?:^|,)r=([^,]+)/.exec(bare)?.[1] ?? '') + randomBytes(18).toString('base64');
      this.serverFirst = `r=${nonce},s=${salt.toString('base64')},i=${iterations}`;
      this.clientFirst = bare;
      this.entry.scram = {
        mechanism: front.body.subarray(0, end).toString('latin1'),
        flag: first.slice(0, 1),
        iterations,
        proofVerified: null,
      };
      // Why: An iteration count over the client's bound is sent as given and never derived.
      this.salted =
        iterations > 1_000_000
          ? Buffer.alloc(0)
          : pbkdf2Sync(Buffer.from(config.password, 'utf8'), salt, iterations, 32, 'sha256');
      this.out.write(authRequest(11, Buffer.from(this.serverFirst)));
      this.stage = 'final';
      return;
    }
    const final = front.body.toString('utf8');
    const proofAt = final.lastIndexOf(',p=');
    const authMessage = `${this.clientFirst},${this.serverFirst},${final.slice(0, proofAt)}`;
    const clientKey = hmac(this.salted, 'Client Key');
    const expected = xor(clientKey, hmac(createHash('sha256').update(clientKey).digest(), authMessage));
    if (this.entry.scram !== null) {
      this.entry.scram.proofVerified = expected.equals(Buffer.from(final.slice(proofAt + 3), 'base64'));
    }
    const signature = hmac(hmac(this.salted, 'Server Key'), authMessage);
    const sent =
      config.wrongSignature === true ? xor(signature, Buffer.concat([Buffer.from([1]), Buffer.alloc(31)])) : signature;
    this.out.write(authRequest(12, Buffer.from(`v=${sent.toString('base64')}`)));
    this.finishAuthentication();
  }

  private finishAuthentication(): void {
    const parts = [authRequest(0)];
    for (const [name, value] of [
      ['client_encoding', 'UTF8'],
      ['DateStyle', 'ISO, MDY'],
      ['TimeZone', 'UTC'],
    ] as const) {
      parts.push(message('S', cstring(name), cstring(value)));
    }
    if (this.tail.key !== 'none') {
      const short = this.tail.version === '3.0' || this.entry.negotiated;
      parts.push(message('K', int32(1 + (this.entry.id % 1000)), randomBytes(short ? 4 : (this.tail.key ?? 32))));
    }
    parts.push(readyForQuery());
    this.out.write(Buffer.concat(parts));
  }

  private answerCycle(extended: boolean): void {
    this.shared.cycles += 1;
    this.entry.cycles += 1;
    const prefix = extended ? Buffer.concat([message('1'), message('2')]) : Buffer.alloc(0);
    const hostile = this.tail.hostile;
    if (hostile !== undefined && this.shared.cycles === (this.tail.hostileAt ?? 1)) {
      this.out.write(Buffer.concat([prefix, rowDescription()]));
      this.hostile(hostile);
      return;
    }
    this.out.write(
      Buffer.concat([prefix, rowDescription(), dataRow(), message('C', cstring('SELECT 1')), readyForQuery()]),
    );
  }

  private hostile(kind: Hostile): void {
    if (kind === 'field-below-minus-one') {
      this.out.write(message('D', int16(1), int32(-2)));
    } else if (kind === 'field-past-message') {
      this.out.write(message('D', int16(1), int32(1000), Buffer.from('ab')));
    } else {
      this.flood();
      return;
    }
    this.out.write(Buffer.concat([message('C', cstring('SELECT 1')), readyForQuery()]));
  }

  private flood(): void {
    const header = Buffer.concat([Buffer.from('D', 'latin1'), int32(this.tail.declaredLength ?? 0x7fffffff)]);
    this.out.write(header);
    this.entry.hostileWritten += header.length;
    const pump = (): void => {
      while (!this.entry.closed && this.entry.hostileWritten < WRITE_CAP) {
        this.entry.hostileWritten += CHUNK;
        if (!this.out.write(Buffer.alloc(CHUNK))) {
          this.out.once('drain', pump);
          return;
        }
      }
      this.entry.hostileCapped = this.entry.hostileWritten >= WRITE_CAP;
    };
    pump();
  }
}

export async function startHostileServer(config: HostileConfig): Promise<HostileServer> {
  const preTls = config.mode === 'tls-n' || config.mode === 'tls-extra' || config.mode === 'tls-error';
  const leaf = config.mode === 'self-signed' || config.mode === 'wrong-host' ? config.mode : 'good';
  const authority = makeAuthority(leaf);
  const marker = `fixture-text-${randomBytes(6).toString('hex')}`;
  const tail: SessionTail = config.mode === 'auth-ok' || config.mode === 'scram' ? config : {};
  const connections: HostileConnection[] = [];
  const sockets = new Set<Socket>();
  const waiters: { index: number; resolve: () => void }[] = [];
  const shared = { cycles: 0 };

  const settle = (): void => {
    for (const waiter of [...waiters]) {
      if (connections[waiter.index]?.closed === true) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };

  const serveTls = async (socket: Socket, entry: HostileConnection): Promise<void> => {
    const first = await readExactly(socket, 8);
    entry.raw = Buffer.from(first);
    if (first.readUInt32BE(0) !== 8 || first.readUInt32BE(4) !== SSL_REQUEST || socket.readableLength !== 0) {
      socket.destroy();
      return;
    }
    socket.write('S');
    const secure = new TLSSocket(socket, {
      isServer: true,
      secureContext: authority.leaf,
      ALPNProtocols: [config.mode === 'alpn-other' ? 'other' : 'postgresql'],
    });
    sockets.add(secure);
    secure.on('error', (error: NodeJS.ErrnoException) => {
      entry.tlsError ??= error.code ?? error.message;
    });
    secure.once('secure', () => {
      entry.handshake = 'completed';
      entry.alpn = secure.alpnProtocol;
    });
    secure.once('close', () => {
      sockets.delete(secure);
      entry.closed = true;
      settle();
    });
    new Session(config, tail, entry, secure, shared).attach();
  };

  const servePreTls = (socket: Socket, entry: HostileConnection): void => {
    let answered = false;
    socket.on('data', (chunk: Buffer) => {
      entry.raw = Buffer.concat([entry.raw, chunk]);
      if (answered || entry.raw.length < 8) {
        return;
      }
      answered = true;
      if (config.mode === 'tls-n') {
        socket.write('N');
      } else if (config.mode === 'tls-extra') {
        socket.write(Buffer.concat([Buffer.from('S'), Buffer.alloc(config.extra ?? 1, 0x58)]));
      } else {
        socket.write(errorResponse('FATAL', '08P01', marker));
      }
    });
  };

  const listener: Server = createServer((socket: Socket) => {
    const entry: HostileConnection = {
      id: connections.length + 1,
      raw: Buffer.alloc(0),
      received: Buffer.alloc(0),
      messages: [],
      handshake: 'none',
      alpn: null,
      tlsError: null,
      startupVersion: null,
      negotiated: false,
      scram: null,
      cycles: 0,
      hostileWritten: 0,
      hostileCapped: false,
      closed: false,
    };
    connections.push(entry);
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
      entry.closed = true;
      settle();
    });
    socket.on('error', () => undefined);
    if (preTls) {
      servePreTls(socket, entry);
    } else {
      serveTls(socket, entry).catch(() => socket.destroy());
    }
  });
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the fixture has no port');
  }

  return {
    port: address.port,
    ca: authority.ca,
    marker,
    connections,
    closed: (index) =>
      new Promise<void>((resolve) => {
        if (connections[index]?.closed === true) {
          resolve();
        } else {
          waiters.push({ index, resolve });
        }
      }),
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };
}
