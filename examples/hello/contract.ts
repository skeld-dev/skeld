import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

const Name = t.string({ minLength: 1, maxLength: 64 });
const Greeting = t.object({ message: t.string({ maxLength: 72 }) });

export const helloContract = defineContract({
  greet: {
    method: 'GET',
    path: '/hello/:name',
    params: t.object({ name: Name }),
    query: t.object({ excited: t.optional(t.boolean()) }),
    responses: { 200: Greeting },
  },
  greetInLanguage: {
    method: 'POST',
    path: '/hello',
    body: t.object({ name: Name, language: t.union([t.literal('en'), t.literal('pt')]) }),
    responses: { 200: Greeting },
  },
});
