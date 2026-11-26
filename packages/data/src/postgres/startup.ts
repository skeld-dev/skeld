// Does:  Runs startup and sign-in on an open transport, from the startup message to the first ReadyForQuery.
// Holds: No password-derived byte is sent before the server asks for SCRAM, and none is accepted without its proof.

import type { TLSSocket } from 'node:tls';
import { expose } from '@skeld/core/secret';
import type { Reason } from '../data-error/reason.ts';
import type { ConnectStage } from '../data-error/types.ts';
import { Breach, decodeText, errorFields, Fields, type Frame } from './reader.ts';
import { preparePassword } from './saslprep.ts';
import {
  clientFirstMessage,
  endPointBinding,
  type Mechanism,
  type ScramStart,
  scramFinal,
  scramStart,
  scramVerify,
} from './scram.ts';
import type { PostgresTarget } from './target.ts';
import { PROTOCOL_3_0, PROTOCOL_3_2, saslInitialResponse, saslResponse, startupMessage } from './wire.ts';

export interface StartupLink {
  next(): Promise<Frame>;
  write(data: Buffer): void;
}

export interface Started {
  readonly protocol: '3.2' | '3.0';
  readonly processId: number;
  readonly key: Buffer;
  readonly settings: ReadonlyMap<string, string>;
  readonly mechanism: Mechanism | 'none';
}

export class StartupFailure extends Error {
  readonly stage: ConnectStage;
  readonly reason: Reason;
  readonly fields: ReadonlyMap<string, string> | null;

  constructor(stage: ConnectStage, reason: Reason, fields: ReadonlyMap<string, string> | null = null) {
    super('startup failed');
    this.stage = stage;
    this.reason = reason;
    this.fields = fields;
  }
}

const AUTH_OK = 0;
const AUTH_SASL = 10;
const AUTH_SASL_CONTINUE = 11;
const AUTH_SASL_FINAL = 12;
// Why: BackendKeyData's key is 4 bytes before 3.2 and 4 to 256 bytes on 3.2 (protocol-message-formats, BackendKeyData).
const MAX_KEY_BYTES = 256;

function type(code: string): number {
  return code.charCodeAt(0);
}

// Does:  Tracks which stage a failure belongs to while startup runs, so a timeout or close names the step it cut.
export class StartupProgress {
  authenticated = false;
  asked = false;

  get stage(): ConnectStage {
    return this.authenticated || !this.asked ? 'startup' : 'authentication';
  }
}

// Does:  Holds the sign-in state across the server's messages and answers each authentication request in turn.
class SignIn {
  readonly #target: PostgresTarget;
  readonly #certificate: TLSSocket | null;
  readonly #link: StartupLink;
  #start: ScramStart | null = null;
  #expected: Buffer | null = null;
  #verified = false;
  readonly #progress: StartupProgress;

  constructor(target: PostgresTarget, certificate: TLSSocket | null, link: StartupLink, progress: StartupProgress) {
    this.#target = target;
    this.#certificate = certificate;
    this.#link = link;
    this.#progress = progress;
  }

  get mechanism(): Mechanism | 'none' {
    return this.#start?.mechanism ?? 'none';
  }

  // Does:  Answers one Authentication message; returns true at AuthenticationOk.
  async answer(fields: Fields): Promise<boolean> {
    const code = fields.int32();
    if (code === AUTH_OK) {
      fields.done();
      if (this.#start !== null && !this.#verified) {
        throw new StartupFailure('authentication', 'signature');
      }
      if (this.#start === null && this.#target.password !== null) {
        throw new StartupFailure('authentication', 'not-asked');
      }
      return true;
    }
    this.#progress.asked = true;
    if (code === AUTH_SASL && this.#start === null) {
      this.#begin(fields);
    } else if (code === AUTH_SASL_CONTINUE && this.#start !== null && this.#expected === null) {
      await this.#continue(this.#start, decodeText(fields.rest()));
    } else if (code === AUTH_SASL_FINAL && this.#expected !== null && !this.#verified) {
      const reason = scramVerify(decodeText(fields.rest()), this.#expected);
      this.#expected.fill(0);
      if (reason !== null) {
        throw new StartupFailure('authentication', reason);
      }
      this.#verified = true;
    } else if (code === AUTH_SASL || code === AUTH_SASL_CONTINUE || code === AUTH_SASL_FINAL) {
      throw new Breach();
    } else {
      throw new StartupFailure('authentication', 'method');
    }
    return false;
  }

  #begin(fields: Fields): void {
    if (this.#target.password === null) {
      throw new StartupFailure('authentication', 'no-password');
    }
    const listed: string[] = [];
    for (let name = fields.string(); name !== ''; name = fields.string()) {
      listed.push(name);
    }
    fields.done();
    const certificate = this.#certificate?.getPeerX509Certificate();
    const binding = certificate === undefined ? null : endPointBinding(certificate);
    const started = scramStart(listed, binding, this.#target.bindingRequired);
    if (!started.ok) {
      throw new StartupFailure('authentication', started.reason);
    }
    this.#start = started.value;
    this.#link.write(saslInitialResponse(started.value.mechanism, clientFirstMessage(started.value)));
  }

  async #continue(start: ScramStart, serverFirst: string): Promise<void> {
    const password = this.#target.password;
    if (password === null) {
      throw new StartupFailure('authentication', 'no-password');
    }
    const prepared = preparePassword(expose(password));
    const final = await scramFinal(prepared, start, serverFirst);
    prepared.fill(0);
    if (!final.ok) {
      throw new StartupFailure('authentication', final.reason);
    }
    this.#expected = final.value.serverSignature;
    this.#link.write(saslResponse(Buffer.from(final.value.message, 'utf8')));
  }
}

function backendKey(fields: Fields, protocol: '3.2' | '3.0'): { processId: number; key: Buffer } {
  const processId = fields.int32();
  const key = Buffer.from(fields.rest());
  const fits = protocol === '3.0' ? key.length === 4 : key.length >= 4 && key.length <= MAX_KEY_BYTES;
  if (!fits) {
    throw new Breach();
  }
  return { processId, key };
}

// Does:  Reads the server's startup messages in order, answering sign-in and keeping what ReadyForQuery needs.
class StartupReader {
  readonly #signIn: SignIn;
  readonly #progress: StartupProgress;
  readonly #settings = new Map<string, string>();
  #protocol: '3.2' | '3.0' = '3.2';
  #negotiated = false;
  #backend: { processId: number; key: Buffer } | null = null;

  constructor(signIn: SignIn, progress: StartupProgress) {
    this.#signIn = signIn;
    this.#progress = progress;
  }

  // Does:  Handles one message; returns the started session at ReadyForQuery, else null.
  async step(frame: Frame): Promise<Started | null> {
    const fields = new Fields(frame.body);
    const authenticated = this.#progress.authenticated;
    if (frame.type === type('v')) {
      this.#version(fields);
    } else if (frame.type === type('E')) {
      throw new StartupFailure(this.#progress.stage, 'rejected', errorFields(frame.body));
    } else if (frame.type === type('R') && !authenticated) {
      this.#progress.authenticated = await this.#signIn.answer(fields);
    } else if (frame.type === type('S') && authenticated) {
      const name = fields.string();
      this.#settings.set(name, fields.string());
      fields.done();
    } else if (frame.type === type('K') && authenticated && this.#backend === null) {
      this.#backend = backendKey(fields, this.#protocol);
    } else if (frame.type === type('Z') && authenticated) {
      return this.#ready(fields);
    } else if (frame.type !== type('N')) {
      throw new Breach();
    }
    return null;
  }

  #version(fields: Fields): void {
    const version = fields.int32();
    const options = fields.int32();
    // Why: Only a fall back to 3.0 with no unrecognised option is spoken; anything else ends the attempt.
    if (this.#negotiated || version !== PROTOCOL_3_0 || options !== 0) {
      throw new StartupFailure('startup', 'version');
    }
    fields.done();
    this.#negotiated = true;
    this.#protocol = '3.0';
  }

  #ready(fields: Fields): Started {
    const status = fields.byte();
    fields.done();
    if (status !== type('I')) {
      throw new Breach();
    }
    if (this.#backend === null) {
      throw new StartupFailure('startup', 'no-key');
    }
    if (this.#settings.get('client_encoding') !== 'UTF8') {
      throw new StartupFailure('startup', 'encoding');
    }
    return { protocol: this.#protocol, ...this.#backend, settings: this.#settings, mechanism: this.#signIn.mechanism };
  }
}

// Does:  Sends the startup message and reads the server's answers until ReadyForQuery says idle.
// Holds: The session is returned only with a cancel key, client_encoding UTF8 and, given a password, a verified proof.
export async function startSession(
  link: StartupLink,
  target: PostgresTarget,
  certificate: TLSSocket | null,
  progress: StartupProgress,
): Promise<Started> {
  const reader = new StartupReader(new SignIn(target, certificate, link, progress), progress);
  link.write(startupMessage(PROTOCOL_3_2, target.settings));
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: each server message is answered before the next one is read.
    const started = await reader.step(await link.next());
    if (started !== null) {
      return started;
    }
  }
}
