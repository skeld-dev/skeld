const SPACE = 0x20;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the class is JSON's escape set: controls, quote, backslash, surrogates
const NEEDS_ESCAPE = /[\u0000-\u001f"\\\ud800-\udfff]/;
// Below 16 code units a charCodeAt scan beats the regular-expression test on Node 26.
const SCAN_LIMIT = 16;

function viaNative(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

export function escaped(text: string): string {
  const { length } = text;
  if (length >= SCAN_LIMIT) {
    return NEEDS_ESCAPE.test(text) ? viaNative(text) : text;
  }
  for (let index = 0; index < length; index++) {
    const code = text.charCodeAt(index);
    if (code < SPACE || code === QUOTE || code === BACKSLASH || (code >= FIRST_SURROGATE && code <= LAST_SURROGATE)) {
      return viaNative(text);
    }
  }
  return text;
}
