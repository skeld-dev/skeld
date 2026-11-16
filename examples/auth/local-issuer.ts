import { generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';
import type { Jwk } from '@skeld/auth/jwt';

// A stand-in for an external token issuer, local to this example. Auth verifies JWTs; it never signs them.
// The key pair is made at start and lives only in memory; nothing here is a key to copy.
export interface LocalIssuer {
  readonly issuer: string;
  readonly audience: string;
  // The public key, given to jwt({ keys }) so the service needs no key-set URL.
  readonly jwk: Jwk;
  // Signs a token for the subject, valid for five minutes.
  token(subject: string): string;
}

export function createLocalIssuer(): LocalIssuer {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(8).toString('base64url');
  const issuer = 'urn:example:local-issuer';
  const audience = 'skeld-auth-example';
  return {
    issuer,
    audience,
    jwk: { ...publicKey.export({ format: 'jwk' }), kty: 'RSA', kid, alg: 'RS256', use: 'sig' },
    token: (subject) => {
      const now = Math.floor(Date.now() / 1000);
      return signRs256(privateKey, kid, { iss: issuer, aud: audience, sub: subject, iat: now, exp: now + 300 });
    },
  };
}

// Writes a compact JWS with RS256 (RSASSA-PKCS1-v1_5 over SHA-256, RFC 7518 section 3.3).
export function signRs256(privateKey: KeyObject, kid: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
