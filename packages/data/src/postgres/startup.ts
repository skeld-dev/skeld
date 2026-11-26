// Does:  Runs startup and sign-in on an open transport, from the startup message to the first ReadyForQuery.
// Holds: No password-derived byte is sent before the server asks for SCRAM, and none is accepted without its proof.

import type { TLSSocket } from 'node:tls';
import { expose } from '@skeld/core/secret';
import type { Reason } from '../data-error/reason.ts';
import type { ConnectStage } from '../data-error/types.ts';
import {
  Breach,
  decodeText,
  errorFields,
  type Fields,
  type Frame,
  fieldsOf,
  readByte,
  readDone,
  readInt32,
  readRest,
  readString,
} from './reader.ts';
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

// Does:  Tracks how far startup got, so a timeout or close names the step it cut.
export interface StartupProgress {
  authenticated: boolean;
  asked: boolean;
}

export function createStartupProgress(): StartupProgress {
  return { authenticated: false, asked: false };
}

export function startupStage(progress: StartupProgress): ConnectStage {
  return progress.authenticated || !progress.asked ? 'startup' : 'authentication';
}

interface SignIn {
  readonly mechanism: () => Mechanism | 'none';
  readonly answer: (fields: Fields) => Promise<boolean>;
}

// Does:  Holds the sign-in state across the server's messages and answers each authentication request in turn.
function createSignIn(
  target: PostgresTarget,
  certificate: TLSSocket | null,
  link: StartupLink,
  progress: StartupProgress,
): SignIn {
  let start: ScramStart | null = null;
  let expected: Buffer | null = null;
  let verified = false;

  const begin = (fields: Fields): void => {
    if (target.password === null) {
      throw new StartupFailure('authentication', 'no-password');
    }
    const listed: string[] = [];
    for (let name = readString(fields); name !== ''; name = readString(fields)) {
      listed.push(name);
    }
    readDone(fields);
    const peer = certificate?.getPeerX509Certificate();
    const binding = peer === undefined ? null : endPointBinding(peer);
    const started = scramStart(listed, binding, target.bindingRequired);
    if (!started.ok) {
      throw new StartupFailure('authentication', started.reason);
    }
    start = started.value;
    link.write(saslInitialResponse(started.value.mechanism, clientFirstMessage(started.value)));
  };

  const proceed = async (begun: ScramStart, serverFirst: string): Promise<void> => {
    const password = target.password;
    if (password === null) {
      throw new StartupFailure('authentication', 'no-password');
    }
    const prepared = preparePassword(expose(password));
    const final = await scramFinal(prepared, begun, serverFirst);
    prepared.fill(0);
    if (!final.ok) {
      throw new StartupFailure('authentication', final.reason);
    }
    expected = final.value.serverSignature;
    link.write(saslResponse(Buffer.from(final.value.message, 'utf8')));
  };

  const accepted = (fields: Fields): true => {
    readDone(fields);
    if (start !== null && !verified) {
      throw new StartupFailure('authentication', 'signature');
    }
    if (start === null && target.password !== null) {
      throw new StartupFailure('authentication', 'not-asked');
    }
    return true;
  };

  const verify = (fields: Fields, signature: Buffer): void => {
    const reason = scramVerify(decodeText(readRest(fields)), signature);
    signature.fill(0);
    if (reason !== null) {
      throw new StartupFailure('authentication', reason);
    }
    verified = true;
  };

  // Does:  Answers one Authentication message; returns true at AuthenticationOk.
  const answer = async (fields: Fields): Promise<boolean> => {
    const code = readInt32(fields);
    if (code === AUTH_OK) {
      return accepted(fields);
    }
    progress.asked = true;
    if (code === AUTH_SASL && start === null) {
      begin(fields);
    } else if (code === AUTH_SASL_CONTINUE && start !== null && expected === null) {
      await proceed(start, decodeText(readRest(fields)));
    } else if (code === AUTH_SASL_FINAL && expected !== null && !verified) {
      verify(fields, expected);
    } else if (code === AUTH_SASL || code === AUTH_SASL_CONTINUE || code === AUTH_SASL_FINAL) {
      throw new Breach();
    } else {
      throw new StartupFailure('authentication', 'method');
    }
    return false;
  };

  return Object.freeze({ mechanism: () => start?.mechanism ?? 'none', answer });
}

function backendKey(fields: Fields, protocol: '3.2' | '3.0'): { processId: number; key: Buffer } {
  const processId = readInt32(fields);
  const key = Buffer.from(readRest(fields));
  const fits = protocol === '3.0' ? key.length === 4 : key.length >= 4 && key.length <= MAX_KEY_BYTES;
  if (!fits) {
    throw new Breach();
  }
  return { processId, key };
}

// Does:  Reads the server's startup messages in order, answering sign-in and keeping what ReadyForQuery needs.
function createStartupReader(signIn: SignIn, progress: StartupProgress): (frame: Frame) => Promise<Started | null> {
  const settings = new Map<string, string>();
  let protocol: '3.2' | '3.0' = '3.2';
  let negotiated = false;
  let backend: { processId: number; key: Buffer } | null = null;

  const version = (fields: Fields): void => {
    const offered = readInt32(fields);
    const options = readInt32(fields);
    // Why: Only a fall back to 3.0 with no unrecognised option is spoken; anything else ends the attempt.
    if (negotiated || offered !== PROTOCOL_3_0 || options !== 0) {
      throw new StartupFailure('startup', 'version');
    }
    readDone(fields);
    negotiated = true;
    protocol = '3.0';
  };

  const ready = (fields: Fields): Started => {
    const status = readByte(fields);
    readDone(fields);
    if (status !== type('I')) {
      throw new Breach();
    }
    if (backend === null) {
      throw new StartupFailure('startup', 'no-key');
    }
    if (settings.get('client_encoding') !== 'UTF8') {
      throw new StartupFailure('startup', 'encoding');
    }
    return { protocol, ...backend, settings, mechanism: signIn.mechanism() };
  };

  // Does:  Handles one message; returns the started session at ReadyForQuery, else null.
  return async (frame: Frame): Promise<Started | null> => {
    const fields = fieldsOf(frame.body);
    const authenticated = progress.authenticated;
    if (frame.type === type('v')) {
      version(fields);
    } else if (frame.type === type('E')) {
      throw new StartupFailure(startupStage(progress), 'rejected', errorFields(frame.body));
    } else if (frame.type === type('R') && !authenticated) {
      progress.authenticated = await signIn.answer(fields);
    } else if (frame.type === type('S') && authenticated) {
      const name = readString(fields);
      settings.set(name, readString(fields));
      readDone(fields);
    } else if (frame.type === type('K') && authenticated && backend === null) {
      backend = backendKey(fields, protocol);
    } else if (frame.type === type('Z') && authenticated) {
      return ready(fields);
    } else if (frame.type !== type('N')) {
      throw new Breach();
    }
    return null;
  };
}

// Does:  Sends the startup message and reads the server's answers until ReadyForQuery says idle.
// Holds: The session is returned only with a cancel key, client_encoding UTF8 and, given a password, a verified proof.
export async function startSession(
  link: StartupLink,
  target: PostgresTarget,
  certificate: TLSSocket | null,
  progress: StartupProgress,
): Promise<Started> {
  const step = createStartupReader(createSignIn(target, certificate, link, progress), progress);
  link.write(startupMessage(PROTOCOL_3_2, target.settings));
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: each server message is answered before the next one is read.
    const started = await step(await link.next());
    if (started !== null) {
      return started;
    }
  }
}
