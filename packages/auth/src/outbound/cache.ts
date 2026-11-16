// Does:  Keeps the process's provider configurations and key sets, each trusted only inside its declared freshness.
// Holds: A stale value is never returned; at most one fetch per URL runs at a time and its waiting callers share it.

import { type ProviderConfig, type ProviderRefusal, parseDiscovery } from './discovery.ts';
import { type KeySet, parseKeySet, type VerifyKey } from './jwk.ts';
import { type CacheHeaders, type ConfiguredUrl, fetchJson, type JsonObject } from './outbound.ts';

const DEFAULT_FRESH_MS = 300_000;
const MAX_FRESH_MS = 86_400_000;
const COOLDOWN_MS = 60_000;

export type UnavailableReason = 'fetch' | 'document' | 'stale' | 'bound';

export type Cached<T> =
  | { readonly kind: 'ok'; readonly value: T; readonly sentAt: number }
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason };

export type KeyLookup =
  | { readonly kind: 'key'; readonly key: VerifyKey }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason };

interface Entry<T> {
  value: T | null;
  sentAt: number;
  freshUntil: number;
  failedUntil: number;
  forcedUntil: number;
  flight: Promise<Cached<T>> | null;
}

type Parse<T> = (body: JsonObject) => T | null;

// Why: Freshness and cooldowns run on the monotonic clock, so a wall-clock step can never lengthen trust.
const now = (): number => performance.now();

function createCache<T>() {
  const entries = new Map<string, Entry<T>>();

  const entryOf = (url: ConfiguredUrl): Entry<T> => {
    let entry = entries.get(url.href);
    if (entry === undefined) {
      entry = { value: null, sentAt: 0, freshUntil: 0, failedUntil: 0, forcedUntil: 0, flight: null };
      entries.set(url.href, entry);
    }
    return entry;
  };

  const refresh = (entry: Entry<T>, url: ConfiguredUrl, parse: Parse<T>): Promise<Cached<T>> => {
    const sentAt = now();
    const flight = fetchJson({ url })
      .then((fetched): Cached<T> => {
        if (fetched.kind === 'failed') {
          // Why: A refusal by the process's own bound sent nothing to the provider, so it starts no cooldown.
          if (fetched.reason === 'bound') {
            return { kind: 'unavailable', reason: 'bound' };
          }
          entry.failedUntil = now() + COOLDOWN_MS;
          return { kind: 'unavailable', reason: 'fetch' };
        }
        const value = parse(fetched.body);
        if (value === null) {
          entry.failedUntil = now() + COOLDOWN_MS;
          return { kind: 'unavailable', reason: 'document' };
        }
        entry.value = value;
        entry.sentAt = sentAt;
        entry.freshUntil = sentAt + freshForMs(fetched.headers);
        return { kind: 'ok', value, sentAt };
      })
      .finally(() => {
        entry.flight = null;
      });
    entry.flight = flight;
    return flight;
  };

  return {
    // Does:  Answers the fresh value, or joins or starts the one fetch for the URL unless its failure cooldown runs.
    get(url: ConfiguredUrl, parse: Parse<T>): Promise<Cached<T>> {
      const entry = entryOf(url);
      const at = now();
      if (entry.value !== null && at < entry.freshUntil) {
        return Promise.resolve({ kind: 'ok', value: entry.value, sentAt: entry.sentAt });
      }
      if (entry.flight !== null) {
        return entry.flight;
      }
      if (at < entry.failedUntil) {
        return Promise.resolve({ kind: 'unavailable', reason: entry.value === null ? 'fetch' : 'stale' });
      }
      return refresh(entry, url, parse);
    },

    // Does:  Joins the running fetch or starts one ahead of expiry; null while either cooldown runs.
    // Holds: A forced fetch starts at most once per URL per cooldown, whatever its outcome.
    force(url: ConfiguredUrl, parse: Parse<T>): Promise<Cached<T>> | null {
      const entry = entryOf(url);
      if (entry.flight !== null) {
        return entry.flight;
      }
      const at = now();
      if (at < entry.forcedUntil || at < entry.failedUntil) {
        return null;
      }
      entry.forcedUntil = at + COOLDOWN_MS;
      return refresh(entry, url, parse);
    },
  };
}

const configs = createCache<ProviderConfig>();
const keySets = createCache<KeySet>();

// Does:  Reads a provider's checked configuration; onRefused hears the reason once for each fetched document refused.
export function readProviderConfig(
  url: ConfiguredUrl,
  issuer: string,
  onRefused: (reason: ProviderRefusal) => void,
): Promise<Cached<ProviderConfig>> {
  return configs.get(url, (body) => {
    const verdict = parseDiscovery(body, issuer);
    if (verdict.kind === 'refused') {
      onRefused(verdict.reason);
      return null;
    }
    return verdict.config;
  });
}

// Does:  Finds a key by kid in the URL's fresh key set; an unknown kid may force one shared refresh first.
// Holds: A kid absent from a set fetched after this call began is unknown without a second fetch.
export async function findKey(url: ConfiguredUrl, kid: string): Promise<KeyLookup> {
  const since = now();
  const first = await keySets.get(url, parseKeySet);
  if (first.kind === 'unavailable') {
    return first;
  }
  const known = first.value.get(kid);
  if (known !== undefined) {
    return { kind: 'key', key: known };
  }
  const forced = first.sentAt >= since ? null : keySets.force(url, parseKeySet);
  if (forced === null) {
    return { kind: 'unknown' };
  }
  const second = await forced;
  if (second.kind === 'unavailable') {
    return second;
  }
  const rotated = second.value.get(kid);
  return rotated === undefined ? { kind: 'unknown' } : { kind: 'key', key: rotated };
}

// Does:  Returns how long a response stays fresh: max-age less age, else expires less date, else 300 s, cut at 24 h.
// Holds: Any directive or field that cannot be read exactly makes the response stale at once, never fresher.
function freshForMs(headers: CacheHeaders): number {
  const directives = (headers.cacheControl ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  if (directives.some((part) => named(part, 'no-store') || named(part, 'no-cache'))) {
    return 0;
  }
  const maxAges = directives.filter((part) => named(part, 'max-age'));
  if (maxAges.length > 1) {
    return 0;
  }
  const [maxAge] = maxAges;
  if (maxAge !== undefined) {
    const seconds = maxAge.startsWith('max-age=') ? deltaSeconds(maxAge.slice('max-age='.length)) : null;
    const age = headers.age === undefined ? 0 : deltaSeconds(headers.age);
    if (seconds === null || age === null) {
      return 0;
    }
    return Math.min(Math.max(0, seconds - age) * 1_000, MAX_FRESH_MS);
  }
  if (headers.expires !== undefined) {
    const expires = httpDate(headers.expires);
    const date = headers.date === undefined ? Date.now() : httpDate(headers.date);
    if (expires === null || date === null) {
      return 0;
    }
    return Math.min(Math.max(0, expires - date), MAX_FRESH_MS);
  }
  return DEFAULT_FRESH_MS;
}

// Why: RFC 9110 section 5.6.7's IMF-fixdate, e.g. Sun, 06 Nov 1994 08:49:37 GMT; any other text is not read as a date.
const IMF_FIXDATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

// Does:  Reads an IMF-fixdate as epoch milliseconds; null for other text, a day that does not exist or a wrong weekday.
function httpDate(text: string): number | null {
  if (!IMF_FIXDATE.test(text)) {
    return null;
  }
  const at = Date.parse(text);
  // Why: The round trip refuses what the shape allows but the calendar does not, such as 31 Feb or a wrong day name.
  return !Number.isNaN(at) && new Date(at).toUTCString() === text ? at : null;
}

// Does:  Tells whether a directive names the given one, however malformed what follows its name is.
function named(part: string, name: string): boolean {
  return part === name || (part.startsWith(name) && /^[\s=]/.test(part.slice(name.length)));
}

// Why: RFC 9111 section 1.2.2 defines delta-seconds as digits only; anything else is unreadable.
function deltaSeconds(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null;
}
