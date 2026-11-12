import { randomUUID } from 'node:crypto';
import type { Scope } from '@skeld/core/server';
import { type Task, tasksContract } from './contract.ts';

export function tasks(scope: Scope): void {
  const records = new Map<string, Task>();
  const capacity = 100;
  scope.onClose(() => {
    const entries = records.size;
    records.clear();
    scope.log.info('task store cleared', { entries });
  });

  scope.addHook('onRequest', (context) => {
    context.setHeader('x-example-module', 'tasks');
  });

  scope.routes(tasksContract, {
    create: (request) => {
      if (records.size >= capacity) {
        return { status: 409, body: { status: 409, code: 'TASK_LIMIT', message: 'Task capacity reached' } };
      }
      const task = { id: randomUUID(), title: request.body.title };
      records.set(task.id, task);
      request.log.info('task created', { taskId: task.id });
      return { status: 201, body: task };
    },
    get: ({ params }) => {
      const task = records.get(params.id);
      if (task === undefined) {
        return { status: 404, body: { status: 404, code: 'TASK_NOT_FOUND', message: 'Task not found' } };
      }
      return { status: 200, body: task };
    },
  });
}
