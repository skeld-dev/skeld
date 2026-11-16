// Holds the 200-route fixture of routes200.ts behind the auth gate, compiled against the built declarations:
// - the 200 routes and schemas of routes200.ts, each with access: 40 doc.read, 40 doc.write, 40 team.manage,
//   40 'optional' and 40 'public', in that rotation by route number;
// - two policies from definePolicy: doc (three credential kinds, input, load, two actions) and team (session
//   only, limit, input, load, tenant, one action, not_found denial), and one policy operation called in r0;
// - createAuth with both policies, one limit scope and the API-key, JWT and OIDC parts; a gated createServer;
// - 200 handlers, 120 of which read their grant or principal; auth's session routes with auth.handlers.session
//   and its OIDC routes with the OIDC part's handlers;
// - the session handoff, a limit charge, and client calls: the 20 of routes200.ts on a bearer client, and every
//   session and OIDC route on a session client.
// The store, the API-key, JWT and OIDC parts, createAuth and definePolicy are the exported values, built by
// real calls through the public subpaths.

import { apiKeys } from '@skeld/auth/api-key';
import { jwt } from '@skeld/auth/jwt';
import { oidc } from '@skeld/auth/oidc';
import { definePolicy } from '@skeld/auth/policy';
import { oidcRoutes, sessionRoutes } from '@skeld/auth/routes';
import { createAuth, type SessionState } from '@skeld/auth/server';
import { createSqliteStore } from '@skeld/auth/sqlite';
import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { Secret } from '@skeld/core/secret';
import { createServer, type RawCookies } from '@skeld/core/server';

const contract = defineContract({
  r0: {
    method: 'GET',
    path: '/r0/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r1: {
    method: 'POST',
    path: '/r1',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r2: {
    method: 'GET',
    path: '/r2/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r3: {
    method: 'POST',
    path: '/r3',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r4: {
    method: 'GET',
    path: '/r4/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r5: {
    method: 'POST',
    path: '/r5',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r6: {
    method: 'GET',
    path: '/r6/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r7: {
    method: 'POST',
    path: '/r7',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r8: {
    method: 'GET',
    path: '/r8/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r9: {
    method: 'POST',
    path: '/r9',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r10: {
    method: 'GET',
    path: '/r10/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r11: {
    method: 'POST',
    path: '/r11',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r12: {
    method: 'GET',
    path: '/r12/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r13: {
    method: 'POST',
    path: '/r13',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r14: {
    method: 'GET',
    path: '/r14/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r15: {
    method: 'POST',
    path: '/r15',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r16: {
    method: 'GET',
    path: '/r16/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r17: {
    method: 'POST',
    path: '/r17',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r18: {
    method: 'GET',
    path: '/r18/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r19: {
    method: 'POST',
    path: '/r19',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r20: {
    method: 'GET',
    path: '/r20/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r21: {
    method: 'POST',
    path: '/r21',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r22: {
    method: 'GET',
    path: '/r22/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r23: {
    method: 'POST',
    path: '/r23',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r24: {
    method: 'GET',
    path: '/r24/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r25: {
    method: 'POST',
    path: '/r25',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r26: {
    method: 'GET',
    path: '/r26/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r27: {
    method: 'POST',
    path: '/r27',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r28: {
    method: 'GET',
    path: '/r28/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r29: {
    method: 'POST',
    path: '/r29',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r30: {
    method: 'GET',
    path: '/r30/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r31: {
    method: 'POST',
    path: '/r31',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r32: {
    method: 'GET',
    path: '/r32/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r33: {
    method: 'POST',
    path: '/r33',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r34: {
    method: 'GET',
    path: '/r34/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r35: {
    method: 'POST',
    path: '/r35',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r36: {
    method: 'GET',
    path: '/r36/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r37: {
    method: 'POST',
    path: '/r37',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r38: {
    method: 'GET',
    path: '/r38/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r39: {
    method: 'POST',
    path: '/r39',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r40: {
    method: 'GET',
    path: '/r40/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r41: {
    method: 'POST',
    path: '/r41',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r42: {
    method: 'GET',
    path: '/r42/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r43: {
    method: 'POST',
    path: '/r43',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r44: {
    method: 'GET',
    path: '/r44/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r45: {
    method: 'POST',
    path: '/r45',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r46: {
    method: 'GET',
    path: '/r46/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r47: {
    method: 'POST',
    path: '/r47',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r48: {
    method: 'GET',
    path: '/r48/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r49: {
    method: 'POST',
    path: '/r49',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r50: {
    method: 'GET',
    path: '/r50/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r51: {
    method: 'POST',
    path: '/r51',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r52: {
    method: 'GET',
    path: '/r52/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r53: {
    method: 'POST',
    path: '/r53',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r54: {
    method: 'GET',
    path: '/r54/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r55: {
    method: 'POST',
    path: '/r55',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r56: {
    method: 'GET',
    path: '/r56/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r57: {
    method: 'POST',
    path: '/r57',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r58: {
    method: 'GET',
    path: '/r58/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r59: {
    method: 'POST',
    path: '/r59',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r60: {
    method: 'GET',
    path: '/r60/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r61: {
    method: 'POST',
    path: '/r61',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r62: {
    method: 'GET',
    path: '/r62/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r63: {
    method: 'POST',
    path: '/r63',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r64: {
    method: 'GET',
    path: '/r64/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r65: {
    method: 'POST',
    path: '/r65',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r66: {
    method: 'GET',
    path: '/r66/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r67: {
    method: 'POST',
    path: '/r67',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r68: {
    method: 'GET',
    path: '/r68/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r69: {
    method: 'POST',
    path: '/r69',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r70: {
    method: 'GET',
    path: '/r70/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r71: {
    method: 'POST',
    path: '/r71',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r72: {
    method: 'GET',
    path: '/r72/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r73: {
    method: 'POST',
    path: '/r73',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r74: {
    method: 'GET',
    path: '/r74/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r75: {
    method: 'POST',
    path: '/r75',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r76: {
    method: 'GET',
    path: '/r76/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r77: {
    method: 'POST',
    path: '/r77',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r78: {
    method: 'GET',
    path: '/r78/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r79: {
    method: 'POST',
    path: '/r79',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r80: {
    method: 'GET',
    path: '/r80/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r81: {
    method: 'POST',
    path: '/r81',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r82: {
    method: 'GET',
    path: '/r82/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r83: {
    method: 'POST',
    path: '/r83',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r84: {
    method: 'GET',
    path: '/r84/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r85: {
    method: 'POST',
    path: '/r85',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r86: {
    method: 'GET',
    path: '/r86/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r87: {
    method: 'POST',
    path: '/r87',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r88: {
    method: 'GET',
    path: '/r88/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r89: {
    method: 'POST',
    path: '/r89',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r90: {
    method: 'GET',
    path: '/r90/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r91: {
    method: 'POST',
    path: '/r91',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r92: {
    method: 'GET',
    path: '/r92/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r93: {
    method: 'POST',
    path: '/r93',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r94: {
    method: 'GET',
    path: '/r94/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r95: {
    method: 'POST',
    path: '/r95',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r96: {
    method: 'GET',
    path: '/r96/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r97: {
    method: 'POST',
    path: '/r97',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r98: {
    method: 'GET',
    path: '/r98/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r99: {
    method: 'POST',
    path: '/r99',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r100: {
    method: 'GET',
    path: '/r100/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r101: {
    method: 'POST',
    path: '/r101',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r102: {
    method: 'GET',
    path: '/r102/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r103: {
    method: 'POST',
    path: '/r103',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r104: {
    method: 'GET',
    path: '/r104/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r105: {
    method: 'POST',
    path: '/r105',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r106: {
    method: 'GET',
    path: '/r106/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r107: {
    method: 'POST',
    path: '/r107',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r108: {
    method: 'GET',
    path: '/r108/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r109: {
    method: 'POST',
    path: '/r109',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r110: {
    method: 'GET',
    path: '/r110/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r111: {
    method: 'POST',
    path: '/r111',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r112: {
    method: 'GET',
    path: '/r112/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r113: {
    method: 'POST',
    path: '/r113',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r114: {
    method: 'GET',
    path: '/r114/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r115: {
    method: 'POST',
    path: '/r115',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r116: {
    method: 'GET',
    path: '/r116/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r117: {
    method: 'POST',
    path: '/r117',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r118: {
    method: 'GET',
    path: '/r118/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r119: {
    method: 'POST',
    path: '/r119',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r120: {
    method: 'GET',
    path: '/r120/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r121: {
    method: 'POST',
    path: '/r121',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r122: {
    method: 'GET',
    path: '/r122/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r123: {
    method: 'POST',
    path: '/r123',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r124: {
    method: 'GET',
    path: '/r124/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r125: {
    method: 'POST',
    path: '/r125',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r126: {
    method: 'GET',
    path: '/r126/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r127: {
    method: 'POST',
    path: '/r127',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r128: {
    method: 'GET',
    path: '/r128/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r129: {
    method: 'POST',
    path: '/r129',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r130: {
    method: 'GET',
    path: '/r130/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r131: {
    method: 'POST',
    path: '/r131',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r132: {
    method: 'GET',
    path: '/r132/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r133: {
    method: 'POST',
    path: '/r133',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r134: {
    method: 'GET',
    path: '/r134/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r135: {
    method: 'POST',
    path: '/r135',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r136: {
    method: 'GET',
    path: '/r136/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r137: {
    method: 'POST',
    path: '/r137',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r138: {
    method: 'GET',
    path: '/r138/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r139: {
    method: 'POST',
    path: '/r139',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r140: {
    method: 'GET',
    path: '/r140/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r141: {
    method: 'POST',
    path: '/r141',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r142: {
    method: 'GET',
    path: '/r142/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r143: {
    method: 'POST',
    path: '/r143',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r144: {
    method: 'GET',
    path: '/r144/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r145: {
    method: 'POST',
    path: '/r145',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r146: {
    method: 'GET',
    path: '/r146/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r147: {
    method: 'POST',
    path: '/r147',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r148: {
    method: 'GET',
    path: '/r148/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r149: {
    method: 'POST',
    path: '/r149',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r150: {
    method: 'GET',
    path: '/r150/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r151: {
    method: 'POST',
    path: '/r151',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r152: {
    method: 'GET',
    path: '/r152/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r153: {
    method: 'POST',
    path: '/r153',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r154: {
    method: 'GET',
    path: '/r154/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r155: {
    method: 'POST',
    path: '/r155',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r156: {
    method: 'GET',
    path: '/r156/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r157: {
    method: 'POST',
    path: '/r157',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r158: {
    method: 'GET',
    path: '/r158/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r159: {
    method: 'POST',
    path: '/r159',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r160: {
    method: 'GET',
    path: '/r160/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r161: {
    method: 'POST',
    path: '/r161',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r162: {
    method: 'GET',
    path: '/r162/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r163: {
    method: 'POST',
    path: '/r163',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r164: {
    method: 'GET',
    path: '/r164/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r165: {
    method: 'POST',
    path: '/r165',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r166: {
    method: 'GET',
    path: '/r166/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r167: {
    method: 'POST',
    path: '/r167',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r168: {
    method: 'GET',
    path: '/r168/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r169: {
    method: 'POST',
    path: '/r169',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r170: {
    method: 'GET',
    path: '/r170/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r171: {
    method: 'POST',
    path: '/r171',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r172: {
    method: 'GET',
    path: '/r172/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r173: {
    method: 'POST',
    path: '/r173',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r174: {
    method: 'GET',
    path: '/r174/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r175: {
    method: 'POST',
    path: '/r175',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r176: {
    method: 'GET',
    path: '/r176/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r177: {
    method: 'POST',
    path: '/r177',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r178: {
    method: 'GET',
    path: '/r178/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r179: {
    method: 'POST',
    path: '/r179',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r180: {
    method: 'GET',
    path: '/r180/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r181: {
    method: 'POST',
    path: '/r181',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r182: {
    method: 'GET',
    path: '/r182/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r183: {
    method: 'POST',
    path: '/r183',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r184: {
    method: 'GET',
    path: '/r184/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r185: {
    method: 'POST',
    path: '/r185',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r186: {
    method: 'GET',
    path: '/r186/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r187: {
    method: 'POST',
    path: '/r187',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r188: {
    method: 'GET',
    path: '/r188/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r189: {
    method: 'POST',
    path: '/r189',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r190: {
    method: 'GET',
    path: '/r190/:id',
    access: { policy: 'doc', action: 'read' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r191: {
    method: 'POST',
    path: '/r191',
    access: { policy: 'doc', action: 'write' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r192: {
    method: 'GET',
    path: '/r192/:id',
    access: { policy: 'team', action: 'manage' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r193: {
    method: 'POST',
    path: '/r193',
    access: 'optional',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r194: {
    method: 'GET',
    path: '/r194/:id',
    access: 'public',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r195: {
    method: 'POST',
    path: '/r195',
    access: { policy: 'doc', action: 'read' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r196: {
    method: 'GET',
    path: '/r196/:id',
    access: { policy: 'doc', action: 'write' },
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r197: {
    method: 'POST',
    path: '/r197',
    access: { policy: 'team', action: 'manage' },
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r198: {
    method: 'GET',
    path: '/r198/:id',
    access: 'optional',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r199: {
    method: 'POST',
    path: '/r199',
    access: 'public',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
});

const store = createSqliteStore({ path: '/var/lib/app/auth.db' });
const keys = apiKeys({ maxPerUser: 20 });
const bearer = jwt({
  issuer: 'https://id.example',
  audience: 'api',
  algorithms: ['RS256'],
  jwksUrl: 'https://id.example/jwks.json',
  map: (v) => ({ kind: 'accept', userId: v.subject }),
});
const signIn = oidc({
  providers: { acme: { issuer: 'https://id.example', clientId: 'app', clientSecret: new Secret('s3cret') } },
  failurePath: '/login',
  resolveUser: () => ({ kind: 'deny' }),
});

interface Doc {
  readonly id: string;
  readonly owner: string;
}

interface Team {
  readonly id: string;
  readonly tenant: string;
}

const id = t.string({ maxLength: 64 });

const doc = definePolicy('doc', {
  credentials: ['session', 'api_key', 'jwt'],
  input: { id },
  load: ({ input }): Doc => ({ id: input.id, owner: 'u1' }),
  actions: {
    read: () => true,
    write: ({ principal, resource }) => principal.kind === 'session' && resource.owner === principal.userId,
  },
});

const team = definePolicy('team', {
  credentials: ['session'],
  limit: { max: 100, windowSeconds: 60 },
  input: { id },
  load: async ({ input }): Promise<Team | null> => ({ id: input.id, tenant: 't1' }),
  tenant: {
    of: (resource) => resource.tenant,
    member: ({ principal, tenant }) => principal.kind === 'session' && tenant === 't1',
  },
  actions: { manage: ({ resource }) => resource.id !== '' },
  denial: 'not_found',
});

const readTitle = doc.operation('read', (grant, prefix: string) => prefix + grant.resource.id);

const auth = createAuth({
  store,
  origin: 'https://app.example',
  policies: [doc, team],
  limits: { login: { max: 5, windowSeconds: 60 } },
  apiKeys: keys,
  jwt: bearer,
  oidc: signIn,
});

export const server = createServer({
  gate: auth.gate,
  publicOrigin: 'https://app.example',
  csrf: { mode: 'strict' },
});
server.routes(contract, {
  r0: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: readTitle(grant, 'd'), n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r1: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r2: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r3: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r4: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r5: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r6: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r7: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r8: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r9: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r10: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r11: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r12: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r13: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r14: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r15: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r16: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r17: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r18: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r19: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r20: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r21: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r22: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r23: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r24: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r25: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r26: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r27: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r28: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r29: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r30: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r31: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r32: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r33: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r34: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r35: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r36: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r37: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r38: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r39: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r40: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r41: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r42: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r43: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r44: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r45: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r46: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r47: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r48: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r49: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r50: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r51: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r52: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r53: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r54: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r55: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r56: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r57: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r58: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r59: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r60: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r61: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r62: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r63: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r64: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r65: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r66: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r67: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r68: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r69: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r70: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r71: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r72: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r73: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r74: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r75: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r76: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r77: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r78: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r79: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r80: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r81: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r82: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r83: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r84: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r85: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r86: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r87: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r88: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r89: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r90: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r91: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r92: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r93: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r94: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r95: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r96: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r97: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r98: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r99: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r100: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r101: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r102: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r103: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r104: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r105: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r106: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r107: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r108: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r109: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r110: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r111: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r112: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r113: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r114: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r115: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r116: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r117: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r118: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r119: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r120: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r121: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r122: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r123: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r124: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r125: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r126: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r127: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r128: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r129: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r130: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r131: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r132: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r133: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r134: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r135: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r136: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r137: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r138: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r139: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r140: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r141: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r142: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r143: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r144: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r145: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r146: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r147: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r148: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r149: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r150: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r151: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r152: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r153: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r154: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r155: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r156: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r157: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r158: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r159: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r160: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r161: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r162: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r163: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r164: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r165: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r166: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r167: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r168: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r169: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r170: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r171: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r172: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r173: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r174: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r175: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r176: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r177: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r178: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r179: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r180: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r181: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r182: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r183: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r184: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r185: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r186: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r187: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r188: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r189: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r190: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r191: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r192: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r193: ({ body, principal }) => ({ status: 201, body: { id: principal === null ? body.a : principal.kind, n: 1 } }),
  r194: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r195: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r196: ({ params, grant }) =>
    params.n > 0 && grant.resource.id !== ''
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r197: ({ body, grant }) => ({ status: 201, body: { id: grant.principal.kind, n: body.b ? 1 : 0 } }),
  r198: ({ params, principal }) =>
    principal !== null && params.n > 0
      ? { status: 200, body: { id: principal.kind, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r199: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
});
server.routes(sessionRoutes, auth.handlers.session);
server.routes(oidcRoutes, signIn.handlers);

export async function signInWith(rawCookies: RawCookies, userId: string): Promise<SessionState> {
  const verdict = await auth.limits.charge('login', userId);
  if (verdict.kind !== 'pass') {
    return { status: 'none' };
  }
  const result = await auth.sessions.establish({ rawCookies, userId, verify: () => true });
  return result.kind === 'established' ? result.session : { status: 'none' };
}

const client = createClient(contract, {
  baseUrl: 'http://127.0.0.1:3000',
  credential: { kind: 'bearer', token: () => 'token' },
});
const sessionClient = createClient(sessionRoutes, {
  baseUrl: 'http://127.0.0.1:3000',
  credential: { kind: 'session', csrfToken: () => null },
});
const oidcClient = createClient(oidcRoutes, {
  baseUrl: 'http://127.0.0.1:3000',
  credential: { kind: 'session', csrfToken: () => null },
});

export async function signInFlow(): Promise<number> {
  let total = 0;
  const state = await sessionClient.authSession();
  if (state.status === 200 && state.body.status === 'session') {
    total += state.body.expiresAt;
  }
  const out = await sessionClient.authSignOut();
  const clear = await sessionClient.authSessionClear();
  total += out.status + clear.status;
  const start = await oidcClient.authOidcStart({ params: { provider: 'local' }, body: {} });
  if (start.status === 200) {
    total += start.body.url.length;
  }
  const back = await oidcClient.authOidcCallback({ params: { provider: 'local' }, query: { state: 's' } });
  return total + back.status;
}

export async function run(): Promise<number> {
  let total = 0;
  {
    const res = await client.r0({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r11({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r20({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r31({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r40({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r51({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r60({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r71({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r80({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r91({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r100({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r111({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r120({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r131({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r140({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r151({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r160({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r171({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r180({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r191({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  return total;
}
