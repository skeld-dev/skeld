import { Type } from 'typebox';
import { createClient } from '@darkstart/core/client';
import { defineContract } from '@darkstart/core/contract';
import { createServer } from '@darkstart/core/server';

const contract = defineContract({
  r0: {
    method: 'GET',
    path: '/r0/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r1: {
    method: 'POST',
    path: '/r1',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r2: {
    method: 'GET',
    path: '/r2/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r3: {
    method: 'POST',
    path: '/r3',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r4: {
    method: 'GET',
    path: '/r4/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r5: {
    method: 'POST',
    path: '/r5',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r6: {
    method: 'GET',
    path: '/r6/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r7: {
    method: 'POST',
    path: '/r7',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r8: {
    method: 'GET',
    path: '/r8/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r9: {
    method: 'POST',
    path: '/r9',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r10: {
    method: 'GET',
    path: '/r10/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r11: {
    method: 'POST',
    path: '/r11',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r12: {
    method: 'GET',
    path: '/r12/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r13: {
    method: 'POST',
    path: '/r13',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r14: {
    method: 'GET',
    path: '/r14/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r15: {
    method: 'POST',
    path: '/r15',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r16: {
    method: 'GET',
    path: '/r16/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r17: {
    method: 'POST',
    path: '/r17',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r18: {
    method: 'GET',
    path: '/r18/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r19: {
    method: 'POST',
    path: '/r19',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r20: {
    method: 'GET',
    path: '/r20/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r21: {
    method: 'POST',
    path: '/r21',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r22: {
    method: 'GET',
    path: '/r22/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r23: {
    method: 'POST',
    path: '/r23',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r24: {
    method: 'GET',
    path: '/r24/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r25: {
    method: 'POST',
    path: '/r25',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r26: {
    method: 'GET',
    path: '/r26/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r27: {
    method: 'POST',
    path: '/r27',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r28: {
    method: 'GET',
    path: '/r28/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r29: {
    method: 'POST',
    path: '/r29',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r30: {
    method: 'GET',
    path: '/r30/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r31: {
    method: 'POST',
    path: '/r31',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r32: {
    method: 'GET',
    path: '/r32/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r33: {
    method: 'POST',
    path: '/r33',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r34: {
    method: 'GET',
    path: '/r34/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r35: {
    method: 'POST',
    path: '/r35',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r36: {
    method: 'GET',
    path: '/r36/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r37: {
    method: 'POST',
    path: '/r37',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r38: {
    method: 'GET',
    path: '/r38/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r39: {
    method: 'POST',
    path: '/r39',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r40: {
    method: 'GET',
    path: '/r40/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r41: {
    method: 'POST',
    path: '/r41',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r42: {
    method: 'GET',
    path: '/r42/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r43: {
    method: 'POST',
    path: '/r43',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r44: {
    method: 'GET',
    path: '/r44/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r45: {
    method: 'POST',
    path: '/r45',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r46: {
    method: 'GET',
    path: '/r46/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r47: {
    method: 'POST',
    path: '/r47',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r48: {
    method: 'GET',
    path: '/r48/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r49: {
    method: 'POST',
    path: '/r49',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r50: {
    method: 'GET',
    path: '/r50/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r51: {
    method: 'POST',
    path: '/r51',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r52: {
    method: 'GET',
    path: '/r52/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r53: {
    method: 'POST',
    path: '/r53',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r54: {
    method: 'GET',
    path: '/r54/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r55: {
    method: 'POST',
    path: '/r55',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r56: {
    method: 'GET',
    path: '/r56/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r57: {
    method: 'POST',
    path: '/r57',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r58: {
    method: 'GET',
    path: '/r58/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r59: {
    method: 'POST',
    path: '/r59',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r60: {
    method: 'GET',
    path: '/r60/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r61: {
    method: 'POST',
    path: '/r61',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r62: {
    method: 'GET',
    path: '/r62/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r63: {
    method: 'POST',
    path: '/r63',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r64: {
    method: 'GET',
    path: '/r64/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r65: {
    method: 'POST',
    path: '/r65',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r66: {
    method: 'GET',
    path: '/r66/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r67: {
    method: 'POST',
    path: '/r67',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r68: {
    method: 'GET',
    path: '/r68/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r69: {
    method: 'POST',
    path: '/r69',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r70: {
    method: 'GET',
    path: '/r70/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r71: {
    method: 'POST',
    path: '/r71',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r72: {
    method: 'GET',
    path: '/r72/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r73: {
    method: 'POST',
    path: '/r73',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r74: {
    method: 'GET',
    path: '/r74/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r75: {
    method: 'POST',
    path: '/r75',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r76: {
    method: 'GET',
    path: '/r76/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r77: {
    method: 'POST',
    path: '/r77',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r78: {
    method: 'GET',
    path: '/r78/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r79: {
    method: 'POST',
    path: '/r79',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r80: {
    method: 'GET',
    path: '/r80/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r81: {
    method: 'POST',
    path: '/r81',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r82: {
    method: 'GET',
    path: '/r82/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r83: {
    method: 'POST',
    path: '/r83',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r84: {
    method: 'GET',
    path: '/r84/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r85: {
    method: 'POST',
    path: '/r85',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r86: {
    method: 'GET',
    path: '/r86/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r87: {
    method: 'POST',
    path: '/r87',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r88: {
    method: 'GET',
    path: '/r88/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r89: {
    method: 'POST',
    path: '/r89',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r90: {
    method: 'GET',
    path: '/r90/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r91: {
    method: 'POST',
    path: '/r91',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r92: {
    method: 'GET',
    path: '/r92/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r93: {
    method: 'POST',
    path: '/r93',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r94: {
    method: 'GET',
    path: '/r94/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r95: {
    method: 'POST',
    path: '/r95',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r96: {
    method: 'GET',
    path: '/r96/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r97: {
    method: 'POST',
    path: '/r97',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r98: {
    method: 'GET',
    path: '/r98/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r99: {
    method: 'POST',
    path: '/r99',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r100: {
    method: 'GET',
    path: '/r100/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r101: {
    method: 'POST',
    path: '/r101',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r102: {
    method: 'GET',
    path: '/r102/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r103: {
    method: 'POST',
    path: '/r103',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r104: {
    method: 'GET',
    path: '/r104/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r105: {
    method: 'POST',
    path: '/r105',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r106: {
    method: 'GET',
    path: '/r106/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r107: {
    method: 'POST',
    path: '/r107',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r108: {
    method: 'GET',
    path: '/r108/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r109: {
    method: 'POST',
    path: '/r109',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r110: {
    method: 'GET',
    path: '/r110/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r111: {
    method: 'POST',
    path: '/r111',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r112: {
    method: 'GET',
    path: '/r112/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r113: {
    method: 'POST',
    path: '/r113',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r114: {
    method: 'GET',
    path: '/r114/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r115: {
    method: 'POST',
    path: '/r115',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r116: {
    method: 'GET',
    path: '/r116/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r117: {
    method: 'POST',
    path: '/r117',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r118: {
    method: 'GET',
    path: '/r118/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r119: {
    method: 'POST',
    path: '/r119',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r120: {
    method: 'GET',
    path: '/r120/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r121: {
    method: 'POST',
    path: '/r121',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r122: {
    method: 'GET',
    path: '/r122/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r123: {
    method: 'POST',
    path: '/r123',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r124: {
    method: 'GET',
    path: '/r124/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r125: {
    method: 'POST',
    path: '/r125',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r126: {
    method: 'GET',
    path: '/r126/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r127: {
    method: 'POST',
    path: '/r127',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r128: {
    method: 'GET',
    path: '/r128/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r129: {
    method: 'POST',
    path: '/r129',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r130: {
    method: 'GET',
    path: '/r130/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r131: {
    method: 'POST',
    path: '/r131',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r132: {
    method: 'GET',
    path: '/r132/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r133: {
    method: 'POST',
    path: '/r133',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r134: {
    method: 'GET',
    path: '/r134/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r135: {
    method: 'POST',
    path: '/r135',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r136: {
    method: 'GET',
    path: '/r136/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r137: {
    method: 'POST',
    path: '/r137',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r138: {
    method: 'GET',
    path: '/r138/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r139: {
    method: 'POST',
    path: '/r139',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r140: {
    method: 'GET',
    path: '/r140/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r141: {
    method: 'POST',
    path: '/r141',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r142: {
    method: 'GET',
    path: '/r142/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r143: {
    method: 'POST',
    path: '/r143',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r144: {
    method: 'GET',
    path: '/r144/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r145: {
    method: 'POST',
    path: '/r145',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r146: {
    method: 'GET',
    path: '/r146/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r147: {
    method: 'POST',
    path: '/r147',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r148: {
    method: 'GET',
    path: '/r148/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r149: {
    method: 'POST',
    path: '/r149',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r150: {
    method: 'GET',
    path: '/r150/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r151: {
    method: 'POST',
    path: '/r151',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r152: {
    method: 'GET',
    path: '/r152/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r153: {
    method: 'POST',
    path: '/r153',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r154: {
    method: 'GET',
    path: '/r154/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r155: {
    method: 'POST',
    path: '/r155',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r156: {
    method: 'GET',
    path: '/r156/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r157: {
    method: 'POST',
    path: '/r157',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r158: {
    method: 'GET',
    path: '/r158/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r159: {
    method: 'POST',
    path: '/r159',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r160: {
    method: 'GET',
    path: '/r160/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r161: {
    method: 'POST',
    path: '/r161',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r162: {
    method: 'GET',
    path: '/r162/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r163: {
    method: 'POST',
    path: '/r163',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r164: {
    method: 'GET',
    path: '/r164/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r165: {
    method: 'POST',
    path: '/r165',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r166: {
    method: 'GET',
    path: '/r166/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r167: {
    method: 'POST',
    path: '/r167',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r168: {
    method: 'GET',
    path: '/r168/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r169: {
    method: 'POST',
    path: '/r169',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r170: {
    method: 'GET',
    path: '/r170/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r171: {
    method: 'POST',
    path: '/r171',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r172: {
    method: 'GET',
    path: '/r172/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r173: {
    method: 'POST',
    path: '/r173',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r174: {
    method: 'GET',
    path: '/r174/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r175: {
    method: 'POST',
    path: '/r175',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r176: {
    method: 'GET',
    path: '/r176/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r177: {
    method: 'POST',
    path: '/r177',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r178: {
    method: 'GET',
    path: '/r178/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r179: {
    method: 'POST',
    path: '/r179',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r180: {
    method: 'GET',
    path: '/r180/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r181: {
    method: 'POST',
    path: '/r181',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r182: {
    method: 'GET',
    path: '/r182/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r183: {
    method: 'POST',
    path: '/r183',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r184: {
    method: 'GET',
    path: '/r184/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r185: {
    method: 'POST',
    path: '/r185',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r186: {
    method: 'GET',
    path: '/r186/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r187: {
    method: 'POST',
    path: '/r187',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r188: {
    method: 'GET',
    path: '/r188/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r189: {
    method: 'POST',
    path: '/r189',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r190: {
    method: 'GET',
    path: '/r190/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r191: {
    method: 'POST',
    path: '/r191',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r192: {
    method: 'GET',
    path: '/r192/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r193: {
    method: 'POST',
    path: '/r193',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r194: {
    method: 'GET',
    path: '/r194/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r195: {
    method: 'POST',
    path: '/r195',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r196: {
    method: 'GET',
    path: '/r196/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r197: {
    method: 'POST',
    path: '/r197',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
  r198: {
    method: 'GET',
    path: '/r198/:id',
    params: Type.Object({ id: Type.String(), n: Type.Integer() }),
    responses: {
      200: Type.Object({ id: Type.String(), n: Type.Number() }),
      404: Type.Object({ code: Type.String(), message: Type.String() }),
    },
  },
  r199: {
    method: 'POST',
    path: '/r199',
    body: Type.Object({ a: Type.String(), b: Type.Boolean() }),
    responses: { 201: Type.Object({ id: Type.String(), n: Type.Number() }) },
  },
});

export const server = createServer();
server.routes(contract, {
  r0: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r1: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r2: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r3: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r4: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r5: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r6: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r7: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r8: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r9: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r10: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r11: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r12: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r13: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r14: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r15: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r16: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r17: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r18: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r19: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r20: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r21: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r22: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r23: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r24: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r25: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r26: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r27: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r28: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r29: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r30: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r31: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r32: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r33: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r34: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r35: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r36: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r37: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r38: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r39: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r40: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r41: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r42: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r43: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r44: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r45: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r46: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r47: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r48: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r49: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r50: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r51: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r52: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r53: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r54: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r55: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r56: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r57: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r58: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r59: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r60: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r61: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r62: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r63: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r64: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r65: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r66: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r67: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r68: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r69: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r70: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r71: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r72: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r73: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r74: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r75: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r76: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r77: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r78: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r79: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r80: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r81: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r82: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r83: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r84: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r85: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r86: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r87: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r88: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r89: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r90: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r91: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r92: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r93: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r94: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r95: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r96: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r97: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r98: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r99: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r100: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r101: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r102: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r103: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r104: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r105: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r106: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r107: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r108: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r109: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r110: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r111: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r112: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r113: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r114: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r115: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r116: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r117: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r118: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r119: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r120: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r121: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r122: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r123: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r124: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r125: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r126: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r127: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r128: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r129: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r130: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r131: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r132: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r133: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r134: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r135: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r136: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r137: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r138: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r139: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r140: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r141: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r142: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r143: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r144: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r145: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r146: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r147: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r148: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r149: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r150: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r151: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r152: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r153: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r154: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r155: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r156: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r157: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r158: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r159: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r160: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r161: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r162: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r163: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r164: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r165: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r166: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r167: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r168: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r169: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r170: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r171: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r172: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r173: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r174: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r175: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r176: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r177: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r178: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r179: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r180: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r181: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r182: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r183: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r184: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r185: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r186: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r187: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r188: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r189: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r190: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r191: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r192: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r193: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r194: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r195: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r196: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r197: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
  r198: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r199: ({ body }) => ({ status: 201, body: { id: body.a, n: 1 } }),
});

const client = createClient(contract, { baseUrl: 'http://127.0.0.1:3000' });

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
