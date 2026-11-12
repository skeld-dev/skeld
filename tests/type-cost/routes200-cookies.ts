import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';

const contract = defineContract({
  r0: {
    method: 'GET',
    path: '/r0/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r1: {
    method: 'POST',
    path: '/r1',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r2: {
    method: 'GET',
    path: '/r2/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r3: {
    method: 'POST',
    path: '/r3',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r4: {
    method: 'GET',
    path: '/r4/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r5: {
    method: 'POST',
    path: '/r5',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r6: {
    method: 'GET',
    path: '/r6/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r7: {
    method: 'POST',
    path: '/r7',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r8: {
    method: 'GET',
    path: '/r8/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r9: {
    method: 'POST',
    path: '/r9',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r10: {
    method: 'GET',
    path: '/r10/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r11: {
    method: 'POST',
    path: '/r11',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r12: {
    method: 'GET',
    path: '/r12/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r13: {
    method: 'POST',
    path: '/r13',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r14: {
    method: 'GET',
    path: '/r14/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r15: {
    method: 'POST',
    path: '/r15',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r16: {
    method: 'GET',
    path: '/r16/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r17: {
    method: 'POST',
    path: '/r17',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r18: {
    method: 'GET',
    path: '/r18/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r19: {
    method: 'POST',
    path: '/r19',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r20: {
    method: 'GET',
    path: '/r20/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r21: {
    method: 'POST',
    path: '/r21',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r22: {
    method: 'GET',
    path: '/r22/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r23: {
    method: 'POST',
    path: '/r23',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r24: {
    method: 'GET',
    path: '/r24/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r25: {
    method: 'POST',
    path: '/r25',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r26: {
    method: 'GET',
    path: '/r26/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r27: {
    method: 'POST',
    path: '/r27',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r28: {
    method: 'GET',
    path: '/r28/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r29: {
    method: 'POST',
    path: '/r29',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r30: {
    method: 'GET',
    path: '/r30/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r31: {
    method: 'POST',
    path: '/r31',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r32: {
    method: 'GET',
    path: '/r32/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r33: {
    method: 'POST',
    path: '/r33',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r34: {
    method: 'GET',
    path: '/r34/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r35: {
    method: 'POST',
    path: '/r35',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r36: {
    method: 'GET',
    path: '/r36/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r37: {
    method: 'POST',
    path: '/r37',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r38: {
    method: 'GET',
    path: '/r38/:id',
    params: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    responses: {
      200: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }),
      404: t.object({ code: t.string({ maxLength: 64 }), message: t.string({ maxLength: 64 }) }),
    },
  },
  r39: {
    method: 'POST',
    path: '/r39',
    cookies: t.object({
      session: t.string({ maxLength: 64, sensitivity: 'secret' }),
      theme: t.string({ maxLength: 16 }),
      visits: t.integer({ minimum: 0, maximum: 1000 }),
      lang: t.optional(t.string({ maxLength: 8 })),
    }),
    body: t.object({ a: t.string({ maxLength: 64 }), b: t.boolean() }),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
});

export const server = createServer();
server.routes(contract, {
  r0: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r1: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r2: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r3: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r4: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r5: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r6: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r7: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r8: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r9: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r10: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r11: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r12: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r13: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r14: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r15: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r16: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r17: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r18: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r19: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r20: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r21: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r22: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r23: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r24: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r25: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r26: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r27: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r28: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r29: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r30: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r31: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r32: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r33: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r34: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r35: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r36: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r37: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
  r38: ({ params, cookies }) =>
    params.n > 0
      ? { status: 200, body: { id: cookies.theme, n: cookies.visits + params.n } }
      : { status: 404, body: { code: 'NOT_FOUND', message: cookies.lang ?? 'x' } },
  r39: ({ body, cookies }) => ({ status: 201, body: { id: body.a + cookies.theme, n: cookies.visits } }),
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
    const res = await client.r1({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r4({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r5({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r8({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r9({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r12({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r13({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r16({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r17({ body: { a: 'x', b: true } });
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
    const res = await client.r21({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r24({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r25({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r28({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r29({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r32({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r33({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r36({ params: { id: 'a', n: 1 } });
    if (res.status === 200) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r37({ body: { a: 'x', b: true } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  return total;
}
