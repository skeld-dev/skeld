// Does:  Escapes a string for the inside of a JSON string literal.
// Holds: The result equals JSON.stringify(text) without its quotes for every input, lone surrogates included.

const SPACE = 0x20;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the class is JSON's escape set: controls, quote, backslash, surrogates
const NEEDS_ESCAPE = /[\u0000-\u001f"\\\ud800-\udfff]/;
// Why: Below 16 code units a charCodeAt scan beats the regular-expression test on Node 26.
const SCAN_LIMIT = 16;

// Why: JSON.stringify stays the reference for every escape; only the decision whether one is needed is made here.
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
