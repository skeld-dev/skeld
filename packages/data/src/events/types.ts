// Does:  Declares the writers of data's four registered security events.
// Holds: Each writer is one core SecurityEvent, registered once per database plugin.

import type { SecurityEvent } from '@skeld/core/gate';

export interface DataEvents {
  readonly connectFailed: SecurityEvent;
  readonly connectionClosed: SecurityEvent;
  readonly statementFailed: SecurityEvent;
  readonly insecure: SecurityEvent;
}
