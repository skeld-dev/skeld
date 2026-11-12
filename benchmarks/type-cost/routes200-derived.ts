import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';

const r1Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r3Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r5Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r7Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r9Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r11Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r13Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r15Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r17Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r19Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r21Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r23Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r25Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r27Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r29Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r31Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r33Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r35Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r37Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r39Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r41Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r43Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r45Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r47Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r49Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r51Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r53Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r55Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r57Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r59Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r61Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r63Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r65Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r67Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r69Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r71Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r73Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r75Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r77Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });
const r79Created = t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) });

const contract = defineContract({
  r0: {
    method: 'GET',
    path: '/r0/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r1: {
    method: 'POST',
    path: '/r1',
    body: t.partial(t.pick(r1Created, ['id'])),
    responses: { 201: r1Created },
  },
  r2: {
    method: 'GET',
    path: '/r2/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r3: {
    method: 'POST',
    path: '/r3',
    body: t.partial(t.pick(r3Created, ['id'])),
    responses: { 201: r3Created },
  },
  r4: {
    method: 'GET',
    path: '/r4/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r5: {
    method: 'POST',
    path: '/r5',
    body: t.partial(t.pick(r5Created, ['id'])),
    responses: { 201: r5Created },
  },
  r6: {
    method: 'GET',
    path: '/r6/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r7: {
    method: 'POST',
    path: '/r7',
    body: t.partial(t.pick(r7Created, ['id'])),
    responses: { 201: r7Created },
  },
  r8: {
    method: 'GET',
    path: '/r8/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r9: {
    method: 'POST',
    path: '/r9',
    body: t.partial(t.pick(r9Created, ['id'])),
    responses: { 201: r9Created },
  },
  r10: {
    method: 'GET',
    path: '/r10/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r11: {
    method: 'POST',
    path: '/r11',
    body: t.partial(t.pick(r11Created, ['id'])),
    responses: { 201: r11Created },
  },
  r12: {
    method: 'GET',
    path: '/r12/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r13: {
    method: 'POST',
    path: '/r13',
    body: t.partial(t.pick(r13Created, ['id'])),
    responses: { 201: r13Created },
  },
  r14: {
    method: 'GET',
    path: '/r14/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r15: {
    method: 'POST',
    path: '/r15',
    body: t.partial(t.pick(r15Created, ['id'])),
    responses: { 201: r15Created },
  },
  r16: {
    method: 'GET',
    path: '/r16/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r17: {
    method: 'POST',
    path: '/r17',
    body: t.partial(t.pick(r17Created, ['id'])),
    responses: { 201: r17Created },
  },
  r18: {
    method: 'GET',
    path: '/r18/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r19: {
    method: 'POST',
    path: '/r19',
    body: t.partial(t.pick(r19Created, ['id'])),
    responses: { 201: r19Created },
  },
  r20: {
    method: 'GET',
    path: '/r20/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r21: {
    method: 'POST',
    path: '/r21',
    body: t.partial(t.pick(r21Created, ['id'])),
    responses: { 201: r21Created },
  },
  r22: {
    method: 'GET',
    path: '/r22/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r23: {
    method: 'POST',
    path: '/r23',
    body: t.partial(t.pick(r23Created, ['id'])),
    responses: { 201: r23Created },
  },
  r24: {
    method: 'GET',
    path: '/r24/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r25: {
    method: 'POST',
    path: '/r25',
    body: t.partial(t.pick(r25Created, ['id'])),
    responses: { 201: r25Created },
  },
  r26: {
    method: 'GET',
    path: '/r26/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r27: {
    method: 'POST',
    path: '/r27',
    body: t.partial(t.pick(r27Created, ['id'])),
    responses: { 201: r27Created },
  },
  r28: {
    method: 'GET',
    path: '/r28/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r29: {
    method: 'POST',
    path: '/r29',
    body: t.partial(t.pick(r29Created, ['id'])),
    responses: { 201: r29Created },
  },
  r30: {
    method: 'GET',
    path: '/r30/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r31: {
    method: 'POST',
    path: '/r31',
    body: t.partial(t.pick(r31Created, ['id'])),
    responses: { 201: r31Created },
  },
  r32: {
    method: 'GET',
    path: '/r32/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r33: {
    method: 'POST',
    path: '/r33',
    body: t.partial(t.pick(r33Created, ['id'])),
    responses: { 201: r33Created },
  },
  r34: {
    method: 'GET',
    path: '/r34/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r35: {
    method: 'POST',
    path: '/r35',
    body: t.partial(t.pick(r35Created, ['id'])),
    responses: { 201: r35Created },
  },
  r36: {
    method: 'GET',
    path: '/r36/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r37: {
    method: 'POST',
    path: '/r37',
    body: t.partial(t.pick(r37Created, ['id'])),
    responses: { 201: r37Created },
  },
  r38: {
    method: 'GET',
    path: '/r38/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r39: {
    method: 'POST',
    path: '/r39',
    body: t.partial(t.pick(r39Created, ['id'])),
    responses: { 201: r39Created },
  },
  r40: {
    method: 'GET',
    path: '/r40/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r41: {
    method: 'POST',
    path: '/r41',
    body: t.partial(t.pick(r41Created, ['id'])),
    responses: { 201: r41Created },
  },
  r42: {
    method: 'GET',
    path: '/r42/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r43: {
    method: 'POST',
    path: '/r43',
    body: t.partial(t.pick(r43Created, ['id'])),
    responses: { 201: r43Created },
  },
  r44: {
    method: 'GET',
    path: '/r44/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r45: {
    method: 'POST',
    path: '/r45',
    body: t.partial(t.pick(r45Created, ['id'])),
    responses: { 201: r45Created },
  },
  r46: {
    method: 'GET',
    path: '/r46/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r47: {
    method: 'POST',
    path: '/r47',
    body: t.partial(t.pick(r47Created, ['id'])),
    responses: { 201: r47Created },
  },
  r48: {
    method: 'GET',
    path: '/r48/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r49: {
    method: 'POST',
    path: '/r49',
    body: t.partial(t.pick(r49Created, ['id'])),
    responses: { 201: r49Created },
  },
  r50: {
    method: 'GET',
    path: '/r50/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r51: {
    method: 'POST',
    path: '/r51',
    body: t.partial(t.pick(r51Created, ['id'])),
    responses: { 201: r51Created },
  },
  r52: {
    method: 'GET',
    path: '/r52/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r53: {
    method: 'POST',
    path: '/r53',
    body: t.partial(t.pick(r53Created, ['id'])),
    responses: { 201: r53Created },
  },
  r54: {
    method: 'GET',
    path: '/r54/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r55: {
    method: 'POST',
    path: '/r55',
    body: t.partial(t.pick(r55Created, ['id'])),
    responses: { 201: r55Created },
  },
  r56: {
    method: 'GET',
    path: '/r56/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r57: {
    method: 'POST',
    path: '/r57',
    body: t.partial(t.pick(r57Created, ['id'])),
    responses: { 201: r57Created },
  },
  r58: {
    method: 'GET',
    path: '/r58/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r59: {
    method: 'POST',
    path: '/r59',
    body: t.partial(t.pick(r59Created, ['id'])),
    responses: { 201: r59Created },
  },
  r60: {
    method: 'GET',
    path: '/r60/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r61: {
    method: 'POST',
    path: '/r61',
    body: t.partial(t.pick(r61Created, ['id'])),
    responses: { 201: r61Created },
  },
  r62: {
    method: 'GET',
    path: '/r62/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r63: {
    method: 'POST',
    path: '/r63',
    body: t.partial(t.pick(r63Created, ['id'])),
    responses: { 201: r63Created },
  },
  r64: {
    method: 'GET',
    path: '/r64/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r65: {
    method: 'POST',
    path: '/r65',
    body: t.partial(t.pick(r65Created, ['id'])),
    responses: { 201: r65Created },
  },
  r66: {
    method: 'GET',
    path: '/r66/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r67: {
    method: 'POST',
    path: '/r67',
    body: t.partial(t.pick(r67Created, ['id'])),
    responses: { 201: r67Created },
  },
  r68: {
    method: 'GET',
    path: '/r68/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r69: {
    method: 'POST',
    path: '/r69',
    body: t.partial(t.pick(r69Created, ['id'])),
    responses: { 201: r69Created },
  },
  r70: {
    method: 'GET',
    path: '/r70/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r71: {
    method: 'POST',
    path: '/r71',
    body: t.partial(t.pick(r71Created, ['id'])),
    responses: { 201: r71Created },
  },
  r72: {
    method: 'GET',
    path: '/r72/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r73: {
    method: 'POST',
    path: '/r73',
    body: t.partial(t.pick(r73Created, ['id'])),
    responses: { 201: r73Created },
  },
  r74: {
    method: 'GET',
    path: '/r74/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r75: {
    method: 'POST',
    path: '/r75',
    body: t.partial(t.pick(r75Created, ['id'])),
    responses: { 201: r75Created },
  },
  r76: {
    method: 'GET',
    path: '/r76/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r77: {
    method: 'POST',
    path: '/r77',
    body: t.partial(t.pick(r77Created, ['id'])),
    responses: { 201: r77Created },
  },
  r78: {
    method: 'GET',
    path: '/r78/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r79: {
    method: 'POST',
    path: '/r79',
    body: t.partial(t.pick(r79Created, ['id'])),
    responses: { 201: r79Created },
  },
  r80: {
    method: 'GET',
    path: '/r80/:id',
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
    path: '/r82/:id',
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
    path: '/r84/:id',
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
    path: '/r86/:id',
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
    path: '/r88/:id',
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
    path: '/r90/:id',
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
    path: '/r92/:id',
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
    path: '/r94/:id',
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
    path: '/r96/:id',
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
    path: '/r98/:id',
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
    path: '/r100/:id',
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
    path: '/r102/:id',
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
    path: '/r104/:id',
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
    path: '/r106/:id',
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
    path: '/r108/:id',
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
    path: '/r110/:id',
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
    path: '/r112/:id',
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
    path: '/r114/:id',
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
    path: '/r116/:id',
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
    path: '/r118/:id',
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
    path: '/r120/:id',
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
    path: '/r122/:id',
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
    path: '/r124/:id',
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
    path: '/r126/:id',
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
    path: '/r128/:id',
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
    path: '/r130/:id',
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
    path: '/r132/:id',
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
    path: '/r134/:id',
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
    path: '/r136/:id',
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
    path: '/r138/:id',
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
    path: '/r140/:id',
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
    path: '/r142/:id',
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
    path: '/r144/:id',
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
    path: '/r146/:id',
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
    path: '/r148/:id',
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
    path: '/r150/:id',
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
    path: '/r152/:id',
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
    path: '/r154/:id',
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
    path: '/r156/:id',
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
    path: '/r158/:id',
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
    path: '/r160/:id',
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
    path: '/r162/:id',
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
    path: '/r164/:id',
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
    path: '/r166/:id',
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
    path: '/r168/:id',
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
    path: '/r170/:id',
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
    path: '/r172/:id',
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
    path: '/r174/:id',
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
    path: '/r176/:id',
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
    path: '/r178/:id',
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
    path: '/r180/:id',
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
    path: '/r182/:id',
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
    path: '/r184/:id',
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
    path: '/r186/:id',
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
    path: '/r188/:id',
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
    path: '/r190/:id',
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
    path: '/r192/:id',
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
    path: '/r194/:id',
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
    path: '/r196/:id',
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
    path: '/r198/:id',
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

export const server = createServer();
server.routes(contract, {
  r0: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r1: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r2: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r3: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r4: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r5: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r6: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r7: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r8: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r9: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r10: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r11: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r12: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r13: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r14: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r15: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r16: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r17: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r18: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r19: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r20: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r21: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r22: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r23: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r24: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r25: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r26: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r27: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r28: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r29: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r30: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r31: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r32: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r33: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r34: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r35: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r36: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r37: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r38: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r39: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r40: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r41: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r42: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r43: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r44: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r45: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r46: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r47: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r48: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r49: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r50: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r51: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r52: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r53: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r54: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r55: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r56: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r57: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r58: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r59: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r60: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r61: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r62: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r63: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r64: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r65: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r66: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r67: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r68: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r69: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r70: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r71: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r72: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r73: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r74: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r75: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r76: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r77: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
  r78: ({ params }) =>
    params.n > 0
      ? { status: 200, body: { id: params.id, n: params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: 'x' } },
  r79: ({ body }) => ({ status: 201, body: { id: body.id ?? 'none', n: 1 } }),
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
    const res = await client.r11({ body: { id: 'x' } });
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
    const res = await client.r31({ body: { id: 'x' } });
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
    const res = await client.r51({ body: { id: 'x' } });
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
    const res = await client.r71({ body: { id: 'x' } });
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
