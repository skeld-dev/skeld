// Does:  Defines classified, the public pairing of a value with a schema, and the logger's public types.
// Holds: classified never throws and reads nothing of the value; anything but a schema node pairs as no schema.

import { isProxy } from 'node:util/types';
import { isNode } from '../schema/node.ts';
import type { Schema } from '../schema/types.ts';
import { makeClassified } from './classified.ts';
import type { Classified } from './types.ts';

export type {
  Classified,
  DropReason,
  LogFields,
  LogOptions,
  LogSink,
  LogStats,
  LogValue,
  Logger,
  RequestPart,
  Severity,
} from './types.ts';

/**
 * Pairs a value, a scalar included, with a schema, so a log call writes it through that schema's projection.
 * Nothing is read until a log call passes its threshold; a first argument that is not a schema is `[unclassified]`.
 * @example classified(t.string({ maxLength: 64, sensitivity: 'personal' }), 'ada@example.com')
 */
export function classified(schema: Schema, value: unknown): Classified {
  // Why: isNode reads the prototype, which a Proxy's trap could make throw; a Proxy is never a schema node.
  return makeClassified(!isProxy(schema) && isNode(schema) ? schema : null, value);
}
