// Does:  Declares the gate's public types: what a gate tells the server, its boot and bind steps and their outcomes.
// Holds: A refusal names one of nine closed reasons and carries no status, code, message or header of its own.

import type { Access, RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { LogFields, Logger, Severity } from '../log/types.ts';
import type { RawCookies, RawHeaders } from '../server/types.ts';

/** What a gate tells the server's types: the principal it admits and the grant of each policy action. */
export interface AccessTypes {
  /** The principal a credential resolves to. */
  readonly principal: unknown;
  /** The grant a handler receives, by policy name and action name. */
  readonly grants: { readonly [policy: string]: { readonly [action: string]: unknown } };
}

/** The access types of a server without a gate; with them every public type is the one a server had before gates. */
export interface NoAccess extends AccessTypes {
  /** No principal exists. */
  readonly principal: never;
  /** No grant exists. */
  readonly grants: { readonly [policy: string]: never };
  /** Marks the absence of a gate. */
  readonly '~none': true;
}

/**
 * The access control of one server: booted once at `listen`, then bound to every route.
 * `listen` rejects with BootError `GATE_FAILED` when `boot` fails and `ACCESS_REFUSED` when `bind` returns a finding.
 */
export interface Gate<A extends AccessTypes> {
  /** Prepares the gate once at `listen`, after the plugins settle; a `GateFault` names the cause. */
  boot(context: GateBoot): void | Promise<void>;
  /** Binds one route, synchronously: a `RouteGate`, a finding that refuses the route, or `null` for a public route. */
  bind(route: GateRoute): RouteGate<A['principal']> | GateFinding | null;
  /** Carries the access types to the server's types; never read at runtime. */
  readonly '~access'?: A;
}

/** What `Gate.boot` receives: the root scope's log, signal and disposer stack, and the security-event registry. */
export interface GateBoot {
  /** The server's logger. */
  readonly log: Logger;
  /** Aborted when shutdown or startup rollback begins. */
  readonly signal: AbortSignal;
  /** Registers a disposer, run after the transport drains and before the log closes, under `closeTimeoutMs`. */
  onClose(callback: () => void | Promise<void>): void;
  /** Time each disposer has to settle, in milliseconds: the server's `pluginCloseTimeoutMs`. */
  readonly closeTimeoutMs: number;
  /** The server's `publicOrigin`, resolved to a list. */
  readonly publicOrigin: readonly string[];
  /**
   * Registers a security event and returns its writer; callable only inside `boot`, at most 64 times.
   * A name is lower-case and dotted, at most 64 characters, never `skeld.`-prefixed and never repeated, or boot fails.
   */
  event(name: string, severity: Severity): SecurityEvent;
}

/** One route as `Gate.bind` sees it. */
export interface GateRoute {
  /** The route's name, method and path. */
  readonly info: RouteInfo;
  /** The route's definition as declared. */
  readonly definition: RouteDefinition;
  /** The route's declared access. */
  readonly access: Access;
  /** The route group's cross-site mode and whether the group lists the route in `csrfExempt`. */
  readonly csrf: { readonly strict: boolean; readonly exempt: boolean };
}

/** Why a route is refused at boot: printable characters, cut at 200. */
export interface GateFinding {
  /** The reason, written into the boot error's message. */
  readonly finding: string;
}

/** The per-request steps of one bound route. */
export interface RouteGate<P> {
  /** Whether `identify` can admit on a cookie alone; such a route needs a strict cross-site group. */
  readonly cookie: boolean;
  /** Finds the request's principal after the cross-site check and before any `onRequest` hook. */
  identify(request: GateRequest): IdentifyOutcome<P> | Promise<IdentifyOutcome<P>>;
  /** Decides a policy route after validation and before any `preHandler` hook; `null` only on an `'optional'` route. */
  readonly authorize:
    | ((principal: P, input: GateInput, request: GateRequest) => AuthorizeOutcome | Promise<AuthorizeOutcome>)
    | null;
  /** Releases a grant once, when its request stops running; `null` when the route issues none. */
  readonly release: ((grant: unknown) => void) | null;
}

/** One request as the gate sees it; the same object in both steps, never given to application code. */
export interface GateRequest {
  /** The matched route. */
  readonly route: RouteInfo;
  /** The request method as received. */
  readonly method: string;
  /** The raw request headers. */
  readonly headers: RawHeaders;
  /** The request's cookies as sent. */
  readonly rawCookies: RawCookies;
  /** The client's IP address. */
  readonly clientAddress: string;
  /** Aborted when the connection closes or the request times out. */
  readonly signal: AbortSignal;
  /** The request's logger. */
  readonly log: Logger;
  /** The request's local id. */
  readonly requestId: string;
}

/** The handler's own validated values, as `authorize` receives them. */
export interface GateInput {
  /** The validated path parameters. */
  readonly params: unknown;
  /** The validated query parameters. */
  readonly query: unknown;
  /** The validated headers. */
  readonly headers: unknown;
  /** The validated cookies. */
  readonly cookies: unknown;
  /** The validated body. */
  readonly body: unknown;
}

/**
 * What `identify` answers; a `null` principal admits only on an `'optional'` route.
 * An admit whose `principal` is missing or `undefined` is a fault, answered with the fixed 500.
 */
export type IdentifyOutcome<P> =
  | {
      /** Whether the request is admitted or refused. */
      readonly kind: 'admit';
      /** The caller identified, or `null` for none. */
      readonly principal: P | null;
    }
  | GateRefusal;

/**
 * What `authorize` answers; the server passes the grant to the handler by identity, never copied or wrapped.
 * An admit whose `grant` is missing or `undefined` is a fault, answered with the fixed 500.
 */
export type AuthorizeOutcome =
  | {
      /** Whether the request is admitted or refused. */
      readonly kind: 'admit';
      /** The grant the handler receives as `request.grant`. */
      readonly grant: unknown;
    }
  | GateRefusal;

/**
 * A refusal by reason; the server writes its status, code, message and headers.
 * A `challenge` other than `'bearer'` or `null` (a missing one included), or a `retryAfterSeconds` outside 1 to 86,400, is the fixed 500.
 */
export type GateRefusal =
  | {
      /** Marks a refusal. */
      readonly kind: 'refuse';
      /** Why the request is refused; the server maps each reason to its status and code. */
      readonly reason: 'credential_missing' | 'credential_invalid';
      /** Whether the response carries `www-authenticate: Bearer`. */
      readonly challenge: 'bearer' | null;
    }
  | {
      readonly kind: 'refuse';
      readonly reason: 'rate_limited';
      /** Whole seconds until a retry can pass, written as `retry-after`. */
      readonly retryAfterSeconds: number;
    }
  | {
      readonly kind: 'refuse';
      readonly reason:
        | 'credential_conflict'
        | 'csrf_token'
        | 'access_denied'
        | 'access_hidden'
        | 'resource_missing'
        | 'unavailable';
    };

/**
 * Writes one record of a registered security event, in category `security` at its declared severity.
 * Given a request's logger the record carries that request's id and route; it never throws.
 */
export type SecurityEvent = (log: Logger, fields?: LogFields) => void;
