// Does:  Finds the counted address of a client (an IPv4 address or an IPv6 /64) and the counter key of a rule for it.
// Holds: A key is the SHA-256 of the rule's name, a zero byte and the counted address; no address is kept in it.

import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

const ZERO = new Uint8Array(1);

// Does:  Expands an address that isIPv6 accepted to its eight 16-bit groups.
function ipv6Groups(address: string): number[] {
  const zone = address.indexOf('%');
  let text = zone === -1 ? address : address.slice(0, zone);
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (isIPv4(last)) {
    const [a = 0, b = 0, c = 0, d = 0] = last.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const first = head === '' ? [] : head.split(':');
  const second = rest === undefined || rest === '' ? [] : rest.split(':');
  const fill = rest === undefined ? [] : new Array<string>(8 - first.length - second.length).fill('0');
  return [...first, ...fill, ...second].map((group) => Number.parseInt(group, 16));
}

// Does:  Returns the counted text of a client address, or null when the text is not an IP address.
export function countedAddress(address: string): string | null {
  if (isIPv4(address)) {
    return address;
  }
  if (!isIPv6(address)) {
    return null;
  }
  const groups = ipv6Groups(address);
  // Why: An IPv4-mapped address (::ffff:0:0/96, RFC 4291 section 2.5.5.2) is the IPv4 client, not one shared /64.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [, , , , , , high = 0, low = 0] = groups;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':');
}

export function counterKey(rule: string, counted: string): Buffer {
  return createHash('sha256').update(rule, 'utf8').update(ZERO).update(counted, 'utf8').digest();
}
