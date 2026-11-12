import { defineContract, errorBodySchema } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

const Task = t.object({
  id: t.string({ minLength: 36, maxLength: 36 }),
  title: t.string({ minLength: 1, maxLength: 120 }),
});

export const tasksContract = defineContract({
  create: {
    method: 'POST',
    path: '/tasks',
    body: t.object({ title: t.string({ minLength: 1, maxLength: 120 }) }),
    responses: { 201: Task, 409: errorBodySchema },
  },
  get: {
    method: 'GET',
    path: '/tasks/:id',
    params: t.object({ id: t.string({ minLength: 36, maxLength: 36 }) }),
    responses: { 200: Task, 404: errorBodySchema },
  },
});

export type Task = t.Infer<typeof Task>;
