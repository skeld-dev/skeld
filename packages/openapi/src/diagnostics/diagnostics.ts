// Does:  Collects located diagnostics and returns them sorted by location, then code, each pair once.
// Holds: A diagnostic's message is fixed by its code; no contract or option value enters it.

import type { DiagnosticCode, OpenApiDiagnostic } from '../openapi/types.ts';
import { compareText } from '../order/order.ts';

export type Location = readonly (string | number)[];

export interface Found {
  readonly code: DiagnosticCode;
  readonly location: Location;
}

const MESSAGES: { readonly [C in DiagnosticCode]: string } = Object.freeze({
  UTF16_LENGTH: 'String length bounds count UTF-16 code units and appear only as x-skeld extensions',
  DECLARED_PROPERTY_COUNT: 'The minimum counts declared properties only; undeclared properties do not count',
  TEXT_PARAMETER: "The value is sent as text; core's strict text grammar decides how it converts",
  PARAMETER_OBJECT_CONSTRAINT: 'A minimum count of these parameters applies, which separate parameters cannot express',
  RESERVED_HEADER: 'OpenAPI ignores this header parameter, so the document omits it',
});

// Does:  Orders two location steps: numbers before strings, numbers by value, strings by UTF-16 code unit.
function compareStep(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    return typeof a === 'number' ? -1 : 1;
  }
  return compareText(a, b);
}

function compareLocations(a: Location, b: Location): number {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) {
    const step = compareStep(a[index] ?? '', b[index] ?? '');
    if (step !== 0) {
      return step;
    }
  }
  return a.length - b.length;
}

export function finishDiagnostics(found: readonly Found[]): OpenApiDiagnostic[] {
  const sorted = [...found].sort((a, b) => compareLocations(a.location, b.location) || compareText(a.code, b.code));
  const kept: OpenApiDiagnostic[] = [];
  for (const { code, location } of sorted) {
    const last = kept.at(-1);
    if (last !== undefined && last.code === code && compareLocations(last.location, location) === 0) {
      continue;
    }
    kept.push({ code, location: [...location], message: MESSAGES[code] });
  }
  return kept;
}
