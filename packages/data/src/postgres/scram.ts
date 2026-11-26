// Does:  Runs the client side of SCRAM-SHA-256 as functions of the server's messages, channel binding included.
// Holds: A server signature is accepted only after a length check and a constant-time comparison of equal lengths.

import { createHash, createHmac, type X509Certificate, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Reason } from '../data-error/reason.ts';

export type Mechanism = 'SCRAM-SHA-256' | 'SCRAM-SHA-256-PLUS';

export interface ScramStart {
  readonly mechanism: Mechanism;
  readonly gs2Header: string;
  readonly bindingData: Buffer | null;
  readonly nonce: string;
  readonly clientFirstBare: string;
}

export interface ScramFinal {
  readonly message: string;
  readonly serverSignature: Buffer;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: Reason };

// Why: 1,000,000 iterations cost about 0.9 s of one pool thread, so a server cannot stall a connect for longer.
const MAX_ITERATIONS = 1_000_000;
const NONCE_BYTES = 18;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// Why: RFC 5929 section 4.1 hashes with SHA-256 for an MD5 or SHA-1 signature, else with the signature's own hash.
const END_POINT_HASH: ReadonlyMap<string, string> = new Map([
  ['1.2.840.113549.1.1.4', 'sha256'],
  ['1.2.840.113549.1.1.5', 'sha256'],
  ['1.2.840.113549.1.1.14', 'sha224'],
  ['1.2.840.113549.1.1.11', 'sha256'],
  ['1.2.840.113549.1.1.12', 'sha384'],
  ['1.2.840.113549.1.1.13', 'sha512'],
  ['1.2.840.10045.4.1', 'sha256'],
  ['1.2.840.10045.4.3.1', 'sha224'],
  ['1.2.840.10045.4.3.2', 'sha256'],
  ['1.2.840.10045.4.3.3', 'sha384'],
  ['1.2.840.10045.4.3.4', 'sha512'],
]);

// Does:  Computes tls-server-end-point binding data, or null when the signature names no single hash.
export function endPointBinding(certificate: X509Certificate): Buffer | null {
  const hash = END_POINT_HASH.get(certificate.signatureAlgorithmOid);
  return hash === undefined ? null : createHash(hash).update(certificate.raw).digest();
}

// Does:  Picks the mechanism and binding flag from the server's list, by the table of what the server asks.
export function scramStart(
  listed: readonly string[],
  bindingData: Buffer | null,
  bindingRequired: boolean,
): Outcome<ScramStart> {
  if (listed.includes('SCRAM-SHA-256-PLUS') && bindingData !== null) {
    return started('SCRAM-SHA-256-PLUS', 'p=tls-server-end-point,,', bindingData);
  }
  if (bindingRequired) {
    return { ok: false, reason: 'binding' };
  }
  if (!listed.includes('SCRAM-SHA-256')) {
    return { ok: false, reason: 'method' };
  }
  // Why: Flag y says the client could bind; a server that can bind then fails the exchange, exposing a stripped list.
  return started('SCRAM-SHA-256', bindingData === null ? 'n,,' : 'y,,', null);
}

function started(mechanism: Mechanism, gs2Header: string, bindingData: Buffer | null): Outcome<ScramStart> {
  const nonce = randomBytes(NONCE_BYTES).toString('base64');
  // Why: PostgreSQL ignores this user name and uses the startup message's (sasl-authentication, SCRAM-SHA-256).
  return { ok: true, value: { mechanism, gs2Header, bindingData, nonce, clientFirstBare: `n=,r=${nonce}` } };
}

export function clientFirstMessage(start: ScramStart): Buffer {
  return Buffer.from(`${start.gs2Header}${start.clientFirstBare}`, 'utf8');
}

function decodeBase64(text: string): Buffer | null {
  return BASE64.test(text) && text.length > 0 ? Buffer.from(text, 'base64') : null;
}

function deriveKey(password: Buffer, salt: Buffer, iterations: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    // Why: The async form runs on libuv's thread pool, so a large count never blocks the event loop.
    pbkdf2(password, salt, iterations, 32, 'sha256', (error, key) => resolve(error === null ? key : null));
  });
}

function hmac(key: Buffer, text: string): Buffer {
  return createHmac('sha256', key).update(text, 'utf8').digest();
}

// Does:  Checks the server-first message and computes the client-final message and the expected server signature.
// Holds: The salted password and the keys derived from it are zeroed before this returns.
export async function scramFinal(
  password: Buffer,
  start: ScramStart,
  serverFirst: string,
): Promise<Outcome<ScramFinal>> {
  const attributes = serverFirst.split(',');
  const [nonceAttribute, saltAttribute, countAttribute] = attributes;
  if (nonceAttribute?.startsWith('m=') === true) {
    return { ok: false, reason: 'exchange' };
  }
  const serverNonce = nonceAttribute?.startsWith('r=') === true ? nonceAttribute.slice(2) : '';
  const salt = saltAttribute?.startsWith('s=') === true ? decodeBase64(saltAttribute.slice(2)) : null;
  const countText = countAttribute?.startsWith('i=') === true ? countAttribute.slice(2) : '';
  if (!serverNonce.startsWith(start.nonce) || serverNonce.length <= start.nonce.length) {
    return { ok: false, reason: 'exchange' };
  }
  if (salt === null || salt.length === 0 || !/^[0-9]+$/.test(countText)) {
    return { ok: false, reason: 'exchange' };
  }
  const iterations = Number(countText);
  if (iterations < 1 || iterations > MAX_ITERATIONS) {
    return { ok: false, reason: 'iterations' };
  }
  const salted = await deriveKey(password, salt, iterations);
  if (salted === null) {
    return { ok: false, reason: 'exchange' };
  }
  const binding = Buffer.concat([Buffer.from(start.gs2Header, 'utf8'), start.bindingData ?? Buffer.alloc(0)]);
  const withoutProof = `c=${binding.toString('base64')},r=${serverNonce}`;
  const authMessage = `${start.clientFirstBare},${serverFirst},${withoutProof}`;
  const clientKey = hmac(salted, 'Client Key');
  const storedKey = createHash('sha256').update(clientKey).digest();
  const clientSignature = hmac(storedKey, authMessage);
  const proof = Buffer.alloc(clientKey.length);
  for (let index = 0; index < proof.length; index += 1) {
    proof.writeUInt8(clientKey.readUInt8(index) ^ clientSignature.readUInt8(index), index);
  }
  const serverKey = hmac(salted, 'Server Key');
  const serverSignature = hmac(serverKey, authMessage);
  const message = `${withoutProof},p=${proof.toString('base64')}`;
  for (const buffer of [salted, clientKey, storedKey, clientSignature, proof, serverKey]) {
    buffer.fill(0);
  }
  return { ok: true, value: { message, serverSignature } };
}

// Does:  Verifies the server-final message against the expected signature, refusing an error or a wrong proof.
export function scramVerify(serverFinal: string, expected: Buffer): Reason | null {
  const [first] = serverFinal.split(',');
  if (first?.startsWith('e=') === true) {
    return 'rejected';
  }
  const signature = first?.startsWith('v=') === true ? decodeBase64(first.slice(2)) : null;
  if (signature === null) {
    return 'exchange';
  }
  // Why: timingSafeEqual throws on unequal lengths, so the length is compared first and alone.
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return 'signature';
  }
  return null;
}
