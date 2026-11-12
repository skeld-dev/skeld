// Does:  Tests whether a text is a valid cookie name: an HTTP token.
// Holds: Only a non-empty run of token characters passes, so a name never holds a separator, space or control.

// Why: RFC 6265bis draft 22 section 4.1.1 makes a cookie-name a token, whose characters RFC 9110 section 5.6.2 lists.
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function isCookieName(text: string): boolean {
  return TOKEN.test(text);
}
