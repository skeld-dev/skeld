// Does:  Parses a PostgreSQL database's options into the frozen target its connections are opened from.
// Holds: No refusal holds text from the URL, naming a parameter by a fixed list or position; no PG variable is read.

import { isIP } from 'node:net';
import { BootError } from '@skeld/core/boot-error';
import { expose, Secret } from '@skeld/core/secret';
import { type ResolvedBounds, resolveBounds } from '../options/bounds.ts';
import type { PostgresOptions } from './types.ts';
import { PROTOCOL_3_2, startupMessage } from './wire.ts';

export type TransportMode = 'verified' | 'plaintext';

export interface PostgresTarget {
  readonly host: string;
  readonly address: boolean;
  readonly port: number;
  readonly password: Secret<string> | null;
  readonly settings: readonly (readonly [string, string])[];
  readonly transport: TransportMode;
  readonly ca: readonly string[] | null;
  readonly bindingRequired: boolean;
  readonly bounds: ResolvedBounds;
}

// Why: The server refuses a startup packet longer than this, length word included (source/pqcomm.h:148).
const MAX_STARTUP_BYTES = 10_000;
const DEFAULT_PORT = 5432;
const SSLMODES: ReadonlySet<string> = new Set(['require', 'verify-ca', 'verify-full']);
const BINDING: ReadonlySet<string> = new Set(['prefer', 'require']);

// Why: Names libpq documents are echoed in a refusal from this list, so a message never repeats text from the URL.
const KNOWN_NAMES: ReadonlySet<string> = new Set([
  'host',
  'hostaddr',
  'port',
  'dbname',
  'user',
  'password',
  'passfile',
  'require_auth',
  'connect_timeout',
  'client_encoding',
  'options',
  'fallback_application_name',
  'keepalives',
  'keepalives_idle',
  'keepalives_interval',
  'keepalives_count',
  'tcp_user_timeout',
  'replication',
  'gssencmode',
  'requiressl',
  'sslnegotiation',
  'sslcompression',
  'sslcert',
  'sslkey',
  'sslkeylogfile',
  'sslpassword',
  'sslcertmode',
  'sslrootcert',
  'sslcrl',
  'sslcrldir',
  'sslsni',
  'requirepeer',
  'ssl_min_protocol_version',
  'ssl_max_protocol_version',
  'min_protocol_version',
  'max_protocol_version',
  'krbsrvname',
  'gsslib',
  'gssdelegation',
  'service',
  'target_session_attrs',
  'load_balance_hosts',
]);

const UNSUPPORTED =
  'is not supported: use only sslmode, channel_binding or application_name, and percent-encode special characters in the password';

const DNS_NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.?$/;
const PORT = /^[0-9]{1,5}$/;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function refuse(option: string, what: string): BootError {
  return new BootError('INVALID_OPTION', `Invalid option ${option}: ${what}`, null, null);
}

function refuseUrl(part: string, what: string): BootError {
  return refuse('url', `${part} ${what}`);
}

// Does:  Percent-decodes one part as UTF-8, refusing a malformed escape, invalid UTF-8 or a NUL.
function decode(raw: string, part: string): string {
  if (!raw.isWellFormed()) {
    throw refuseUrl(part, 'is not valid UTF-8');
  }
  const encoded = Buffer.from(raw, 'utf8');
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    const byte = encoded.readUInt8(index);
    if (byte !== 0x25) {
      bytes.push(byte);
      continue;
    }
    const hex = encoded.toString('latin1', index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
      throw refuseUrl(part, 'has a malformed percent escape');
    }
    bytes.push(Number.parseInt(hex, 16));
    index += 2;
  }
  let text: string;
  try {
    text = utf8.decode(Uint8Array.from(bytes));
  } catch {
    // Why: The decoder's TypeError says only that the bytes are not UTF-8, which the refusal says without them.
    throw refuseUrl(part, 'is not valid UTF-8');
  }
  if (text.includes('\0')) {
    throw refuseUrl(part, 'holds a NUL');
  }
  return text;
}

interface Server {
  readonly host: string;
  readonly address: boolean;
  readonly port: number;
}

const BRACKETED = /^\[([^\]]*)\](?::(.*))?$/;
const PLAIN = /^([^:]*)(?::(.*))?$/;

function parseServer(hostport: string): Server {
  const bracketed = BRACKETED.exec(hostport);
  const match = bracketed ?? PLAIN.exec(hostport);
  const host = match?.[1] ?? '';
  const address = bracketed === null ? isIP(host) === 4 : isIP(host) === 6;
  if (!address && (bracketed !== null || host.length > 253 || !DNS_NAME.test(host))) {
    throw refuseUrl('host', 'is not one name or address');
  }
  const portText = match?.[2];
  if (portText === undefined) {
    return { host, address, port: DEFAULT_PORT };
  }
  const port = PORT.test(portText) ? Number(portText) : 0;
  if (port < 1 || port > 65_535) {
    throw refuseUrl('port', 'must be 1 to 65535');
  }
  return { host, address, port };
}

interface Authority extends Server {
  readonly user: string;
  readonly password: string | null;
}

function parseAuthority(authority: string): Authority {
  const at = authority.lastIndexOf('@');
  const userinfo = at === -1 ? '' : authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  const user = decode(colon === -1 ? userinfo : userinfo.slice(0, colon), 'user');
  if (user === '') {
    throw refuseUrl('user', 'is required');
  }
  const password = colon === -1 ? '' : decode(userinfo.slice(colon + 1), 'password');
  return { ...parseServer(authority.slice(at + 1)), user, password: password === '' ? null : password };
}

interface Parameters {
  readonly sslmode: boolean;
  readonly bindingRequired: boolean;
  readonly applicationName: string | null;
}

function parseQuery(search: string): Parameters {
  const seen = new Map<string, string>();
  const pairs = search === '' ? [] : search.split('&');
  for (const [index, pair] of pairs.entries()) {
    const equals = pair.indexOf('=');
    const name = decode(equals === -1 ? pair : pair.slice(0, equals), 'a parameter name');
    const allowed = name === 'sslmode' || name === 'channel_binding' || name === 'application_name';
    if (!allowed && KNOWN_NAMES.has(name)) {
      throw refuseUrl(`parameter ${name}`, 'is not supported');
    }
    // Why: An unencoded @ then ? in a password puts its tail where a name is read, so only the position is shown.
    if (!allowed) {
      throw refuseUrl(`parameter ${index + 1} of the query`, UNSUPPORTED);
    }
    if (equals === -1) {
      throw refuseUrl(`parameter ${name}`, 'has no value');
    }
    if (seen.has(name)) {
      throw refuseUrl(`parameter ${name}`, 'is repeated');
    }
    seen.set(name, decode(pair.slice(equals + 1), `parameter ${name}`));
  }
  const sslmode = seen.get('sslmode');
  if (sslmode !== undefined && !SSLMODES.has(sslmode)) {
    throw refuseUrl('parameter sslmode', 'must be require, verify-ca or verify-full');
  }
  const binding = seen.get('channel_binding');
  if (binding !== undefined && !BINDING.has(binding)) {
    throw refuseUrl('parameter channel_binding', 'must be prefer or require');
  }
  return {
    sslmode: sslmode !== undefined,
    bindingRequired: binding === 'require',
    applicationName: seen.get('application_name') ?? null,
  };
}

function parseCa(ca: unknown): readonly string[] | null {
  if (ca === undefined) {
    return null;
  }
  const list: readonly unknown[] = Array.isArray(ca) ? ca : [ca];
  if (!list.every((entry) => typeof entry === 'string')) {
    throw refuse('tls.ca', 'must be a PEM string or an array of them');
  }
  return Object.freeze(list.slice());
}

function parseTls(tls: unknown): { readonly ca: readonly string[] | null; readonly required: boolean } {
  if (tls === undefined) {
    return { ca: null, required: false };
  }
  if (typeof tls !== 'object' || tls === null) {
    throw refuse('tls', 'must be an object');
  }
  const given = new Map<string, unknown>(Object.entries(tls));
  for (const key of given.keys()) {
    if (key !== 'ca' && key !== 'channelBinding') {
      throw refuse(`tls.${key}`, 'unknown option');
    }
  }
  const binding = given.get('channelBinding');
  if (binding !== undefined && binding !== 'when-offered' && binding !== 'required') {
    throw refuse('tls.channelBinding', "must be 'when-offered' or 'required'");
  }
  return { ca: parseCa(given.get('ca')), required: binding === 'required' };
}

function parseInsecure(insecure: unknown): TransportMode {
  if (insecure === undefined) {
    return 'verified';
  }
  if (insecure === 'plaintext') {
    return 'plaintext';
  }
  throw refuse('insecure', "must be 'plaintext'");
}

export function parsePostgresTarget(options: PostgresOptions): PostgresTarget {
  const bounds = resolveBounds(options, 'postgres');
  if (!(options.url instanceof Secret)) {
    throw refuse('url', 'must be a Secret');
  }
  const url = expose(options.url);
  if (typeof url !== 'string') {
    throw refuse('url', 'must be a Secret holding a string');
  }
  const scheme = /^(postgres|postgresql):\/\//i.exec(url);
  if (scheme === null) {
    throw refuseUrl('scheme', 'must be postgres or postgresql');
  }
  const rest = url.slice(scheme[0].length);
  if (rest.includes('#')) {
    throw refuseUrl('fragment', 'is not supported');
  }
  const queryAt = rest.indexOf('?');
  const beforeQuery = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const slash = beforeQuery.indexOf('/');
  const authority = parseAuthority(slash === -1 ? beforeQuery : beforeQuery.slice(0, slash));
  const database = slash === -1 ? '' : decode(beforeQuery.slice(slash + 1), 'database');
  const parameters = parseQuery(queryAt === -1 ? '' : rest.slice(queryAt + 1));
  const tls = parseTls(options.tls);
  const transport = parseInsecure(options.insecure);
  const bindingRequired = parameters.bindingRequired || tls.required;
  if (transport !== 'verified' && parameters.sslmode) {
    throw refuse('insecure', 'cannot be set beside the URL parameter sslmode');
  }
  if (transport === 'plaintext' && bindingRequired) {
    throw refuse('insecure', "'plaintext' cannot be set while channel binding is required");
  }
  const settings: (readonly [string, string])[] = [['user', authority.user]];
  if (database !== '') {
    settings.push(['database', database]);
  }
  settings.push(['client_encoding', 'UTF8'], ['DateStyle', 'ISO'], ['TimeZone', 'UTC']);
  if (parameters.applicationName !== null) {
    settings.push(['application_name', parameters.applicationName]);
  }
  if (startupMessage(PROTOCOL_3_2, settings).length > MAX_STARTUP_BYTES) {
    throw refuseUrl('startup message', `would pass the server's limit of ${MAX_STARTUP_BYTES} bytes`);
  }
  return Object.freeze({
    host: authority.host,
    address: authority.address,
    port: authority.port,
    password: authority.password === null ? null : new Secret(authority.password),
    settings: Object.freeze(settings),
    transport,
    ca: tls.ca,
    bindingRequired,
    bounds,
  });
}
