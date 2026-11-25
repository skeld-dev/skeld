// Does:  Generates an OpenAPI document from the 200 routes of routes200.ts, typed against the built declarations.
// Holds: The schemas are routes200.ts's; only each GET path gains /:n, so its params keys match the path.

import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createOpenApi } from '@skeld/openapi';

export const contract = defineContract({
  r0: {
    method: 'GET',
    path: '/r0/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r1: {
    method: 'POST',
    path: '/r1',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r2: {
    method: 'GET',
    path: '/r2/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r3: {
    method: 'POST',
    path: '/r3',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r4: {
    method: 'GET',
    path: '/r4/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r5: {
    method: 'POST',
    path: '/r5',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r6: {
    method: 'GET',
    path: '/r6/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r7: {
    method: 'POST',
    path: '/r7',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r8: {
    method: 'GET',
    path: '/r8/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r9: {
    method: 'POST',
    path: '/r9',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r10: {
    method: 'GET',
    path: '/r10/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r11: {
    method: 'POST',
    path: '/r11',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r12: {
    method: 'GET',
    path: '/r12/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r13: {
    method: 'POST',
    path: '/r13',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r14: {
    method: 'GET',
    path: '/r14/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r15: {
    method: 'POST',
    path: '/r15',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r16: {
    method: 'GET',
    path: '/r16/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r17: {
    method: 'POST',
    path: '/r17',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r18: {
    method: 'GET',
    path: '/r18/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r19: {
    method: 'POST',
    path: '/r19',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r20: {
    method: 'GET',
    path: '/r20/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r21: {
    method: 'POST',
    path: '/r21',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r22: {
    method: 'GET',
    path: '/r22/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r23: {
    method: 'POST',
    path: '/r23',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r24: {
    method: 'GET',
    path: '/r24/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r25: {
    method: 'POST',
    path: '/r25',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r26: {
    method: 'GET',
    path: '/r26/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r27: {
    method: 'POST',
    path: '/r27',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r28: {
    method: 'GET',
    path: '/r28/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r29: {
    method: 'POST',
    path: '/r29',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r30: {
    method: 'GET',
    path: '/r30/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r31: {
    method: 'POST',
    path: '/r31',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r32: {
    method: 'GET',
    path: '/r32/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r33: {
    method: 'POST',
    path: '/r33',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r34: {
    method: 'GET',
    path: '/r34/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r35: {
    method: 'POST',
    path: '/r35',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r36: {
    method: 'GET',
    path: '/r36/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r37: {
    method: 'POST',
    path: '/r37',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r38: {
    method: 'GET',
    path: '/r38/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r39: {
    method: 'POST',
    path: '/r39',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r40: {
    method: 'GET',
    path: '/r40/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r41: {
    method: 'POST',
    path: '/r41',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r42: {
    method: 'GET',
    path: '/r42/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r43: {
    method: 'POST',
    path: '/r43',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r44: {
    method: 'GET',
    path: '/r44/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r45: {
    method: 'POST',
    path: '/r45',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r46: {
    method: 'GET',
    path: '/r46/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r47: {
    method: 'POST',
    path: '/r47',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r48: {
    method: 'GET',
    path: '/r48/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r49: {
    method: 'POST',
    path: '/r49',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r50: {
    method: 'GET',
    path: '/r50/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r51: {
    method: 'POST',
    path: '/r51',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r52: {
    method: 'GET',
    path: '/r52/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r53: {
    method: 'POST',
    path: '/r53',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r54: {
    method: 'GET',
    path: '/r54/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r55: {
    method: 'POST',
    path: '/r55',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r56: {
    method: 'GET',
    path: '/r56/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r57: {
    method: 'POST',
    path: '/r57',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r58: {
    method: 'GET',
    path: '/r58/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r59: {
    method: 'POST',
    path: '/r59',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r60: {
    method: 'GET',
    path: '/r60/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r61: {
    method: 'POST',
    path: '/r61',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r62: {
    method: 'GET',
    path: '/r62/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r63: {
    method: 'POST',
    path: '/r63',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r64: {
    method: 'GET',
    path: '/r64/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r65: {
    method: 'POST',
    path: '/r65',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r66: {
    method: 'GET',
    path: '/r66/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r67: {
    method: 'POST',
    path: '/r67',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r68: {
    method: 'GET',
    path: '/r68/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r69: {
    method: 'POST',
    path: '/r69',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r70: {
    method: 'GET',
    path: '/r70/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r71: {
    method: 'POST',
    path: '/r71',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r72: {
    method: 'GET',
    path: '/r72/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r73: {
    method: 'POST',
    path: '/r73',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r74: {
    method: 'GET',
    path: '/r74/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r75: {
    method: 'POST',
    path: '/r75',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r76: {
    method: 'GET',
    path: '/r76/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r77: {
    method: 'POST',
    path: '/r77',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r78: {
    method: 'GET',
    path: '/r78/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r79: {
    method: 'POST',
    path: '/r79',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r80: {
    method: 'GET',
    path: '/r80/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r81: {
    method: 'POST',
    path: '/r81',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r82: {
    method: 'GET',
    path: '/r82/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r83: {
    method: 'POST',
    path: '/r83',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r84: {
    method: 'GET',
    path: '/r84/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r85: {
    method: 'POST',
    path: '/r85',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r86: {
    method: 'GET',
    path: '/r86/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r87: {
    method: 'POST',
    path: '/r87',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r88: {
    method: 'GET',
    path: '/r88/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r89: {
    method: 'POST',
    path: '/r89',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r90: {
    method: 'GET',
    path: '/r90/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r91: {
    method: 'POST',
    path: '/r91',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r92: {
    method: 'GET',
    path: '/r92/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r93: {
    method: 'POST',
    path: '/r93',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r94: {
    method: 'GET',
    path: '/r94/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r95: {
    method: 'POST',
    path: '/r95',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r96: {
    method: 'GET',
    path: '/r96/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r97: {
    method: 'POST',
    path: '/r97',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r98: {
    method: 'GET',
    path: '/r98/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r99: {
    method: 'POST',
    path: '/r99',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r100: {
    method: 'GET',
    path: '/r100/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r101: {
    method: 'POST',
    path: '/r101',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r102: {
    method: 'GET',
    path: '/r102/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r103: {
    method: 'POST',
    path: '/r103',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r104: {
    method: 'GET',
    path: '/r104/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r105: {
    method: 'POST',
    path: '/r105',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r106: {
    method: 'GET',
    path: '/r106/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r107: {
    method: 'POST',
    path: '/r107',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r108: {
    method: 'GET',
    path: '/r108/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r109: {
    method: 'POST',
    path: '/r109',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r110: {
    method: 'GET',
    path: '/r110/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r111: {
    method: 'POST',
    path: '/r111',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r112: {
    method: 'GET',
    path: '/r112/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r113: {
    method: 'POST',
    path: '/r113',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r114: {
    method: 'GET',
    path: '/r114/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r115: {
    method: 'POST',
    path: '/r115',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r116: {
    method: 'GET',
    path: '/r116/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r117: {
    method: 'POST',
    path: '/r117',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r118: {
    method: 'GET',
    path: '/r118/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r119: {
    method: 'POST',
    path: '/r119',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r120: {
    method: 'GET',
    path: '/r120/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r121: {
    method: 'POST',
    path: '/r121',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r122: {
    method: 'GET',
    path: '/r122/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r123: {
    method: 'POST',
    path: '/r123',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r124: {
    method: 'GET',
    path: '/r124/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r125: {
    method: 'POST',
    path: '/r125',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r126: {
    method: 'GET',
    path: '/r126/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r127: {
    method: 'POST',
    path: '/r127',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r128: {
    method: 'GET',
    path: '/r128/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r129: {
    method: 'POST',
    path: '/r129',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r130: {
    method: 'GET',
    path: '/r130/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r131: {
    method: 'POST',
    path: '/r131',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r132: {
    method: 'GET',
    path: '/r132/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r133: {
    method: 'POST',
    path: '/r133',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r134: {
    method: 'GET',
    path: '/r134/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r135: {
    method: 'POST',
    path: '/r135',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r136: {
    method: 'GET',
    path: '/r136/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r137: {
    method: 'POST',
    path: '/r137',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r138: {
    method: 'GET',
    path: '/r138/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r139: {
    method: 'POST',
    path: '/r139',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r140: {
    method: 'GET',
    path: '/r140/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r141: {
    method: 'POST',
    path: '/r141',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r142: {
    method: 'GET',
    path: '/r142/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r143: {
    method: 'POST',
    path: '/r143',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r144: {
    method: 'GET',
    path: '/r144/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r145: {
    method: 'POST',
    path: '/r145',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r146: {
    method: 'GET',
    path: '/r146/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r147: {
    method: 'POST',
    path: '/r147',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r148: {
    method: 'GET',
    path: '/r148/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r149: {
    method: 'POST',
    path: '/r149',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r150: {
    method: 'GET',
    path: '/r150/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r151: {
    method: 'POST',
    path: '/r151',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r152: {
    method: 'GET',
    path: '/r152/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r153: {
    method: 'POST',
    path: '/r153',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r154: {
    method: 'GET',
    path: '/r154/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r155: {
    method: 'POST',
    path: '/r155',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r156: {
    method: 'GET',
    path: '/r156/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r157: {
    method: 'POST',
    path: '/r157',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r158: {
    method: 'GET',
    path: '/r158/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r159: {
    method: 'POST',
    path: '/r159',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r160: {
    method: 'GET',
    path: '/r160/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r161: {
    method: 'POST',
    path: '/r161',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r162: {
    method: 'GET',
    path: '/r162/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r163: {
    method: 'POST',
    path: '/r163',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r164: {
    method: 'GET',
    path: '/r164/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r165: {
    method: 'POST',
    path: '/r165',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r166: {
    method: 'GET',
    path: '/r166/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r167: {
    method: 'POST',
    path: '/r167',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r168: {
    method: 'GET',
    path: '/r168/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r169: {
    method: 'POST',
    path: '/r169',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r170: {
    method: 'GET',
    path: '/r170/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r171: {
    method: 'POST',
    path: '/r171',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r172: {
    method: 'GET',
    path: '/r172/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r173: {
    method: 'POST',
    path: '/r173',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r174: {
    method: 'GET',
    path: '/r174/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r175: {
    method: 'POST',
    path: '/r175',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r176: {
    method: 'GET',
    path: '/r176/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r177: {
    method: 'POST',
    path: '/r177',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r178: {
    method: 'GET',
    path: '/r178/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r179: {
    method: 'POST',
    path: '/r179',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r180: {
    method: 'GET',
    path: '/r180/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r181: {
    method: 'POST',
    path: '/r181',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r182: {
    method: 'GET',
    path: '/r182/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r183: {
    method: 'POST',
    path: '/r183',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r184: {
    method: 'GET',
    path: '/r184/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r185: {
    method: 'POST',
    path: '/r185',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r186: {
    method: 'GET',
    path: '/r186/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r187: {
    method: 'POST',
    path: '/r187',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r188: {
    method: 'GET',
    path: '/r188/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r189: {
    method: 'POST',
    path: '/r189',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r190: {
    method: 'GET',
    path: '/r190/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r191: {
    method: 'POST',
    path: '/r191',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r192: {
    method: 'GET',
    path: '/r192/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r193: {
    method: 'POST',
    path: '/r193',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r194: {
    method: 'GET',
    path: '/r194/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r195: {
    method: 'POST',
    path: '/r195',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r196: {
    method: 'GET',
    path: '/r196/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r197: {
    method: 'POST',
    path: '/r197',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r198: {
    method: 'GET',
    path: '/r198/:id/:n',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r199: {
    method: 'POST',
    path: '/r199',
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
});

export const result = createOpenApi(contract, { info: { title: 'Two hundred routes', version: '1.0.0' } });
