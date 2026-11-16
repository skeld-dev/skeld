// Does:  Defines the gate's public values, GateFault and the CSRF token header name, beside the gate types.
// Holds: A GateFault's message is built from its component and finding alone.

export type {
  AccessTypes,
  AuthorizeOutcome,
  Gate,
  GateBoot,
  GateFinding,
  GateInput,
  GateRefusal,
  GateRequest,
  GateRoute,
  IdentifyOutcome,
  NoAccess,
  RouteGate,
  SecurityEvent,
} from './types.ts';

/** The request header a session client writes its CSRF token in, and a gate reads it from. */
export const CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * The error `Gate.boot` throws to name the cause of a failed boot.
 * `listen` rejects with BootError `GATE_FAILED` and the message `gate failed: <component>: <finding>`.
 * @example new GateFault('store', 'not installed')
 */
export class GateFault extends Error {
  override readonly name = 'GateFault';
  /** The part of the gate that failed, an access name such as `store`. */
  readonly component: string;
  /** What failed, in printable characters; the server cuts it at 200. */
  readonly finding: string;

  constructor(component: string, finding: string) {
    super(`${component}: ${finding}`);
    this.component = component;
    this.finding = finding;
  }
}
