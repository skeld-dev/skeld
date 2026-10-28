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
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < FIRST_PRINTABLE || code === DELETE) {
      escaped += text.slice(start, index) + escapeControl(code);
      start = index + 1;
    }
  }
  return start === 0 ? text : escaped + text.slice(start);
}

export function describeThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function writeStderrLine(
  method: string,
  path: string,
  status: number,
  routeName: string,
  message: string,
): void {
  process.stderr.write(
    `darkstart: ${escapeLine(method)} ${escapeLine(path)} ${status} ${routeName}: ${escapeLine(message)}\n`,
  );
}
