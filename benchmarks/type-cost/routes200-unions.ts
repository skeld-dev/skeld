import { createClient } from '@skeld/core/client';
import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';
import { createServer } from '@skeld/core/server';

const contract = defineContract({
  r0: {
    method: 'POST',
    path: '/r0',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r1: {
    method: 'POST',
    path: '/r1',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r2: {
    method: 'POST',
    path: '/r2',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r3: {
    method: 'POST',
    path: '/r3',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r4: {
    method: 'POST',
    path: '/r4',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r5: {
    method: 'POST',
    path: '/r5',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r6: {
    method: 'POST',
    path: '/r6',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r7: {
    method: 'POST',
    path: '/r7',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r8: {
    method: 'POST',
    path: '/r8',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r9: {
    method: 'POST',
    path: '/r9',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r10: {
    method: 'POST',
    path: '/r10',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r11: {
    method: 'POST',
    path: '/r11',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r12: {
    method: 'POST',
    path: '/r12',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r13: {
    method: 'POST',
    path: '/r13',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r14: {
    method: 'POST',
    path: '/r14',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r15: {
    method: 'POST',
    path: '/r15',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r16: {
    method: 'POST',
    path: '/r16',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r17: {
    method: 'POST',
    path: '/r17',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r18: {
    method: 'POST',
    path: '/r18',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r19: {
    method: 'POST',
    path: '/r19',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r20: {
    method: 'POST',
    path: '/r20',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r21: {
    method: 'POST',
    path: '/r21',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r22: {
    method: 'POST',
    path: '/r22',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r23: {
    method: 'POST',
    path: '/r23',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r24: {
    method: 'POST',
    path: '/r24',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r25: {
    method: 'POST',
    path: '/r25',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r26: {
    method: 'POST',
    path: '/r26',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r27: {
    method: 'POST',
    path: '/r27',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r28: {
    method: 'POST',
    path: '/r28',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r29: {
    method: 'POST',
    path: '/r29',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r30: {
    method: 'POST',
    path: '/r30',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r31: {
    method: 'POST',
    path: '/r31',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r32: {
    method: 'POST',
    path: '/r32',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r33: {
    method: 'POST',
    path: '/r33',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r34: {
    method: 'POST',
    path: '/r34',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r35: {
    method: 'POST',
    path: '/r35',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r36: {
    method: 'POST',
    path: '/r36',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r37: {
    method: 'POST',
    path: '/r37',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r38: {
    method: 'POST',
    path: '/r38',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r39: {
    method: 'POST',
    path: '/r39',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r40: {
    method: 'POST',
    path: '/r40',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r41: {
    method: 'POST',
    path: '/r41',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r42: {
    method: 'POST',
    path: '/r42',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r43: {
    method: 'POST',
    path: '/r43',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r44: {
    method: 'POST',
    path: '/r44',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r45: {
    method: 'POST',
    path: '/r45',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r46: {
    method: 'POST',
    path: '/r46',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r47: {
    method: 'POST',
    path: '/r47',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r48: {
    method: 'POST',
    path: '/r48',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r49: {
    method: 'POST',
    path: '/r49',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r50: {
    method: 'POST',
    path: '/r50',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r51: {
    method: 'POST',
    path: '/r51',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r52: {
    method: 'POST',
    path: '/r52',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r53: {
    method: 'POST',
    path: '/r53',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r54: {
    method: 'POST',
    path: '/r54',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r55: {
    method: 'POST',
    path: '/r55',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r56: {
    method: 'POST',
    path: '/r56',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r57: {
    method: 'POST',
    path: '/r57',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r58: {
    method: 'POST',
    path: '/r58',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r59: {
    method: 'POST',
    path: '/r59',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r60: {
    method: 'POST',
    path: '/r60',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r61: {
    method: 'POST',
    path: '/r61',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r62: {
    method: 'POST',
    path: '/r62',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r63: {
    method: 'POST',
    path: '/r63',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r64: {
    method: 'POST',
    path: '/r64',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r65: {
    method: 'POST',
    path: '/r65',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r66: {
    method: 'POST',
    path: '/r66',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r67: {
    method: 'POST',
    path: '/r67',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r68: {
    method: 'POST',
    path: '/r68',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r69: {
    method: 'POST',
    path: '/r69',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r70: {
    method: 'POST',
    path: '/r70',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r71: {
    method: 'POST',
    path: '/r71',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r72: {
    method: 'POST',
    path: '/r72',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r73: {
    method: 'POST',
    path: '/r73',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r74: {
    method: 'POST',
    path: '/r74',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r75: {
    method: 'POST',
    path: '/r75',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r76: {
    method: 'POST',
    path: '/r76',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r77: {
    method: 'POST',
    path: '/r77',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r78: {
    method: 'POST',
    path: '/r78',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r79: {
    method: 'POST',
    path: '/r79',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r80: {
    method: 'POST',
    path: '/r80',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r81: {
    method: 'POST',
    path: '/r81',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r82: {
    method: 'POST',
    path: '/r82',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r83: {
    method: 'POST',
    path: '/r83',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r84: {
    method: 'POST',
    path: '/r84',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r85: {
    method: 'POST',
    path: '/r85',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r86: {
    method: 'POST',
    path: '/r86',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r87: {
    method: 'POST',
    path: '/r87',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r88: {
    method: 'POST',
    path: '/r88',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r89: {
    method: 'POST',
    path: '/r89',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r90: {
    method: 'POST',
    path: '/r90',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r91: {
    method: 'POST',
    path: '/r91',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r92: {
    method: 'POST',
    path: '/r92',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r93: {
    method: 'POST',
    path: '/r93',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r94: {
    method: 'POST',
    path: '/r94',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r95: {
    method: 'POST',
    path: '/r95',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r96: {
    method: 'POST',
    path: '/r96',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r97: {
    method: 'POST',
    path: '/r97',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r98: {
    method: 'POST',
    path: '/r98',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r99: {
    method: 'POST',
    path: '/r99',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r100: {
    method: 'POST',
    path: '/r100',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r101: {
    method: 'POST',
    path: '/r101',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r102: {
    method: 'POST',
    path: '/r102',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r103: {
    method: 'POST',
    path: '/r103',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r104: {
    method: 'POST',
    path: '/r104',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r105: {
    method: 'POST',
    path: '/r105',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r106: {
    method: 'POST',
    path: '/r106',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r107: {
    method: 'POST',
    path: '/r107',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r108: {
    method: 'POST',
    path: '/r108',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r109: {
    method: 'POST',
    path: '/r109',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r110: {
    method: 'POST',
    path: '/r110',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r111: {
    method: 'POST',
    path: '/r111',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r112: {
    method: 'POST',
    path: '/r112',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r113: {
    method: 'POST',
    path: '/r113',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r114: {
    method: 'POST',
    path: '/r114',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r115: {
    method: 'POST',
    path: '/r115',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r116: {
    method: 'POST',
    path: '/r116',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r117: {
    method: 'POST',
    path: '/r117',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r118: {
    method: 'POST',
    path: '/r118',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r119: {
    method: 'POST',
    path: '/r119',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r120: {
    method: 'POST',
    path: '/r120',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r121: {
    method: 'POST',
    path: '/r121',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r122: {
    method: 'POST',
    path: '/r122',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r123: {
    method: 'POST',
    path: '/r123',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r124: {
    method: 'POST',
    path: '/r124',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r125: {
    method: 'POST',
    path: '/r125',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r126: {
    method: 'POST',
    path: '/r126',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r127: {
    method: 'POST',
    path: '/r127',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r128: {
    method: 'POST',
    path: '/r128',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r129: {
    method: 'POST',
    path: '/r129',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r130: {
    method: 'POST',
    path: '/r130',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r131: {
    method: 'POST',
    path: '/r131',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r132: {
    method: 'POST',
    path: '/r132',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r133: {
    method: 'POST',
    path: '/r133',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r134: {
    method: 'POST',
    path: '/r134',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r135: {
    method: 'POST',
    path: '/r135',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r136: {
    method: 'POST',
    path: '/r136',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r137: {
    method: 'POST',
    path: '/r137',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r138: {
    method: 'POST',
    path: '/r138',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r139: {
    method: 'POST',
    path: '/r139',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r140: {
    method: 'POST',
    path: '/r140',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r141: {
    method: 'POST',
    path: '/r141',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r142: {
    method: 'POST',
    path: '/r142',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r143: {
    method: 'POST',
    path: '/r143',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r144: {
    method: 'POST',
    path: '/r144',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r145: {
    method: 'POST',
    path: '/r145',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r146: {
    method: 'POST',
    path: '/r146',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r147: {
    method: 'POST',
    path: '/r147',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r148: {
    method: 'POST',
    path: '/r148',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r149: {
    method: 'POST',
    path: '/r149',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r150: {
    method: 'POST',
    path: '/r150',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r151: {
    method: 'POST',
    path: '/r151',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r152: {
    method: 'POST',
    path: '/r152',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r153: {
    method: 'POST',
    path: '/r153',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r154: {
    method: 'POST',
    path: '/r154',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r155: {
    method: 'POST',
    path: '/r155',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r156: {
    method: 'POST',
    path: '/r156',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r157: {
    method: 'POST',
    path: '/r157',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r158: {
    method: 'POST',
    path: '/r158',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r159: {
    method: 'POST',
    path: '/r159',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r160: {
    method: 'POST',
    path: '/r160',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r161: {
    method: 'POST',
    path: '/r161',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r162: {
    method: 'POST',
    path: '/r162',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r163: {
    method: 'POST',
    path: '/r163',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r164: {
    method: 'POST',
    path: '/r164',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r165: {
    method: 'POST',
    path: '/r165',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r166: {
    method: 'POST',
    path: '/r166',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r167: {
    method: 'POST',
    path: '/r167',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r168: {
    method: 'POST',
    path: '/r168',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r169: {
    method: 'POST',
    path: '/r169',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r170: {
    method: 'POST',
    path: '/r170',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r171: {
    method: 'POST',
    path: '/r171',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r172: {
    method: 'POST',
    path: '/r172',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r173: {
    method: 'POST',
    path: '/r173',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r174: {
    method: 'POST',
    path: '/r174',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r175: {
    method: 'POST',
    path: '/r175',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r176: {
    method: 'POST',
    path: '/r176',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r177: {
    method: 'POST',
    path: '/r177',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r178: {
    method: 'POST',
    path: '/r178',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r179: {
    method: 'POST',
    path: '/r179',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r180: {
    method: 'POST',
    path: '/r180',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r181: {
    method: 'POST',
    path: '/r181',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r182: {
    method: 'POST',
    path: '/r182',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r183: {
    method: 'POST',
    path: '/r183',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r184: {
    method: 'POST',
    path: '/r184',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r185: {
    method: 'POST',
    path: '/r185',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r186: {
    method: 'POST',
    path: '/r186',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r187: {
    method: 'POST',
    path: '/r187',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r188: {
    method: 'POST',
    path: '/r188',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r189: {
    method: 'POST',
    path: '/r189',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r190: {
    method: 'POST',
    path: '/r190',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r191: {
    method: 'POST',
    path: '/r191',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r192: {
    method: 'POST',
    path: '/r192',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r193: {
    method: 'POST',
    path: '/r193',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r194: {
    method: 'POST',
    path: '/r194',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r195: {
    method: 'POST',
    path: '/r195',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r196: {
    method: 'POST',
    path: '/r196',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r197: {
    method: 'POST',
    path: '/r197',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r198: {
    method: 'POST',
    path: '/r198',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
  r199: {
    method: 'POST',
    path: '/r199',
    body: t.union([
      t.object({
        kind: t.literal('a'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        a: t.string({ maxLength: 64 }),
      }),
      t.object({
        kind: t.literal('b'),
        tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }),
        b: t.integer({ minimum: 0, maximum: 1000000 }),
      }),
      t.object({ kind: t.literal('c'), tags: t.array(t.string({ maxLength: 16 }), { maxItems: 8 }), c: t.boolean() }),
    ]),
    responses: { 201: t.object({ id: t.string({ maxLength: 64 }), n: t.integer({ minimum: 0, maximum: 1000000 }) }) },
  },
});

export const server = createServer();
server.routes(contract, {
  r0: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r1: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r2: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r3: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r4: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r5: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r6: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r7: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r8: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r9: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r10: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r11: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r12: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r13: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r14: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r15: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r16: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r17: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r18: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r19: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r20: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r21: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r22: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r23: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r24: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r25: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r26: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r27: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r28: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r29: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r30: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r31: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r32: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r33: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r34: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r35: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r36: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r37: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r38: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r39: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r40: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r41: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r42: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r43: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r44: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r45: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r46: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r47: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r48: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r49: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r50: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r51: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r52: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r53: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r54: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r55: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r56: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r57: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r58: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r59: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r60: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r61: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r62: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r63: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r64: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r65: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r66: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r67: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r68: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r69: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r70: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r71: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r72: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r73: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r74: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r75: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r76: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r77: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r78: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r79: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r80: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r81: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r82: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r83: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r84: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r85: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r86: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r87: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r88: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r89: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r90: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r91: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r92: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r93: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r94: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r95: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r96: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r97: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r98: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r99: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r100: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r101: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r102: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r103: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r104: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r105: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r106: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r107: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r108: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r109: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r110: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r111: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r112: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r113: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r114: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r115: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r116: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r117: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r118: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r119: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r120: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r121: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r122: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r123: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r124: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r125: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r126: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r127: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r128: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r129: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r130: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r131: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r132: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r133: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r134: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r135: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r136: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r137: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r138: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r139: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r140: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r141: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r142: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r143: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r144: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r145: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r146: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r147: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r148: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r149: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r150: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r151: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r152: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r153: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r154: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r155: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r156: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r157: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r158: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r159: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r160: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r161: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r162: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r163: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r164: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r165: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r166: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r167: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r168: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r169: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r170: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r171: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r172: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r173: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r174: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r175: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r176: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r177: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r178: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r179: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r180: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r181: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r182: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r183: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r184: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r185: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r186: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r187: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r188: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r189: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r190: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r191: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r192: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r193: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r194: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r195: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r196: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r197: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r198: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
  r199: ({ body }) => ({ status: 201, body: { id: body.kind, n: body.tags.length } }),
});

const client = createClient(contract, { baseUrl: 'http://127.0.0.1:3000' });

export async function run(): Promise<number> {
  let total = 0;
  {
    const res = await client.r0({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r10({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r20({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r30({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r40({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r50({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r60({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r70({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r80({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r90({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r100({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r110({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r120({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r130({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r140({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r150({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r160({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r170({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r180({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  {
    const res = await client.r190({ body: { kind: 'a', tags: ['x'], a: 'y' } });
    if (res.status === 201) {
      total += res.body.n;
    }
  }
  return total;
}
