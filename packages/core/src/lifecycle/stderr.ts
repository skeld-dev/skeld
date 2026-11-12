// Does:  Writes one operator-facing line per engine failure to stderr.
// Holds: Control characters in request-derived text are escaped, so one failure is always one line.

import { end, start, stderr } from '#diag';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const TAB = 0x09;
const DELETE = 0x7f;
const FIRST_PRINTABLE = 0x20;

function escapeControl(code: number): string {
  switch (code) {
    case NEWLINE:
      return '\\n';
    case CARRIAGE_RETURN:
      return '\\r';
    case TAB:
      return '\\t';
    default:
      return `\\u00${code.toString(16).padStart(2, '0')}`;
  }
}

function escapeLine(text: string): string {
  let escaped = '';
  let sliceFrom = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < FIRST_PRINTABLE || code === DELETE) {
      escaped += text.slice(sliceFrom, index) + escapeControl(code);
      sliceFrom = index + 1;
    }
  }
  return sliceFrom === 0 ? text : escaped + text.slice(sliceFrom);
}

const UNREADABLE = 'a thrown value whose message could not be read';

export function describeThrown(value: unknown): string {
  try {
    const message: unknown = value instanceof Error ? value.message : value;
    return typeof message === 'string' ? message : String(message);
  } catch {
    // Why: An accessor `message` or a throwing `toString` on a thrown value must not escape the error path.
    return UNREADABLE;
  }
}

export function writeStderrLine(
  method: string,
  path: string,
  status: number,
  routeName: string,
  message: string,
): void {
  try {
    const span = start('err.stderr_write');
    const line = `darkstart: ${escapeLine(method)} ${escapeLine(path)} ${status} ${escapeLine(routeName)}: ${escapeLine(message)}\n`;
    stderr(line);
    process.stderr.write(line);
    end(span);
  } catch {
    // Why: Reporting a failed request must never prevent its terminal response when stderr itself fails.
  }
}
