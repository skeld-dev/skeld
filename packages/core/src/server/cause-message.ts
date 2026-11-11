// Does:  Reads a message out of whatever a failed boot step threw.
// Holds: Called at boot only; no text it returns is ever written to a client.

export function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
