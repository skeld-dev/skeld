// Does:  Checks a redirect target: a local path, or an absolute http(s) URL whose origin is on an allowed list.
// Holds: An accepted target is returned as the URL parser serialises it; a refusal never carries the target.

/** Why `checkRedirect` refused a target; the target itself is never part of it. */
export type RedirectRefusal =
  | 'not a string'
  | 'surrounding whitespace'
  | 'control character'
  | 'backslash'
  | 'not a local path'
  | 'not a URL'
  | 'scheme not http or https'
  | 'userinfo'
  | 'origin not allowed';

/** The verdict of `checkRedirect`: the target to send, or the reason it was refused. */
export type RedirectCheck =
  | {
      /** The target may be sent. */
      readonly kind: 'ok';
      /** The target to send, as the WHATWG URL parser serialises it. */
      readonly location: string;
    }
  | {
      /** The target must not be sent. */
      readonly kind: 'refused';
      /** Why it was refused. */
      readonly reason: RedirectRefusal;
    };

// Why: A local path resolves against this fixed base; a parsed origin other than it means the path left the service.
const LOCAL_ORIGIN = 'http://local.invalid';
const DELETE = 0x7f;
const FIRST_PRINTABLE = 0x20;
const BACKSLASH = 0x5c;

function refused(reason: RedirectRefusal): RedirectCheck {
  return { kind: 'refused', reason };
}

// Why: The WHATWG URL parser drops tabs and newlines and reads \ as /, so either could turn a path into a host.
function forbiddenCharacter(text: string): RedirectRefusal | null {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < FIRST_PRINTABLE || code === DELETE) {
      return 'control character';
    }
    if (code === BACKSLASH) {
      return 'backslash';
    }
  }
  return null;
}

function checkLocal(location: string): RedirectCheck {
  // Why: A value starting // names a host (a scheme-relative URL), whichever host that is, the base's included.
  if (location.startsWith('//')) {
    return refused('not a local path');
  }
  const url = URL.parse(location, LOCAL_ORIGIN);
  // Why: '/.//host' keeps the base origin but serialises to '//host', which a browser reads as another host.
  if (url === null || url.origin !== LOCAL_ORIGIN || url.pathname.startsWith('//')) {
    return refused('not a local path');
  }
  return { kind: 'ok', location: url.pathname + url.search + url.hash };
}

function checkAbsolute(location: string, redirectOrigins: readonly string[]): RedirectCheck {
  const url = URL.parse(location);
  if (url === null) {
    return refused('not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return refused('scheme not http or https');
  }
  if (url.username !== '' || url.password !== '') {
    return refused('userinfo');
  }
  return redirectOrigins.includes(url.origin) ? { kind: 'ok', location: url.href } : refused('origin not allowed');
}

/**
 * Checks a redirect target: a path on this service, or an absolute http(s) URL whose exact origin is listed.
 * Refuses whitespace around it, control characters, backslashes and userinfo; `redirectOrigins` defaults to none.
 * @example checkRedirect('/login?next=%2Fhome', ['https://id.example.com'])
 */
export function checkRedirect(location: unknown, redirectOrigins: readonly string[] = []): RedirectCheck {
  if (typeof location !== 'string') {
    return refused('not a string');
  }
  if (location.trim() !== location) {
    return refused('surrounding whitespace');
  }
  const forbidden = forbiddenCharacter(location);
  if (forbidden !== null) {
    return refused(forbidden);
  }
  return location.startsWith('/') ? checkLocal(location) : checkAbsolute(location, redirectOrigins);
}
