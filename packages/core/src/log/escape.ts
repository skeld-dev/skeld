// Does:  Turns any text into the inside of a JSON string, cut at a count of UTF-16 units.
// Holds: The result is well formed and holds no quote, backslash, C0 or C1 control, U+2028 or U+2029 unescaped.

const SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

// Why: U+007F to U+009F and U+2028/U+2029 are line or control characters to some readers though JSON allows them raw.
function needsEscape(code: number): boolean {
  return (
    code < 0x20 ||
    code === 0x22 ||
    code === 0x5c ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029
  );
}

function escapeOf(code: number): string {
  return SHORT_ESCAPES.get(code) ?? `\\u${code.toString(16).padStart(4, '0')}`;
}

// Does:  Where to cut text at maxUnits, one unit earlier when the cut would split a surrogate pair.
function cutAt(text: string, maxUnits: number): number {
  if (text.length <= maxUnits) {
    return text.length;
  }
  const last = text.charCodeAt(maxUnits - 1);
  const next = text.charCodeAt(maxUnits);
  return last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? maxUnits - 1 : maxUnits;
}

export function escapeText(text: string, maxUnits: number): string {
  const end = cutAt(text, maxUnits);
  const well = (end === text.length ? text : text.slice(0, end)).toWellFormed();
  let out = '';
  let start = 0;
  for (let index = 0; index < well.length; index++) {
    const code = well.charCodeAt(index);
    if (needsEscape(code)) {
      out += well.slice(start, index) + escapeOf(code);
      start = index + 1;
    }
  }
  return start === 0 ? well : out + well.slice(start);
}
