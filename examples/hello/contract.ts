import { Type } from 'typebox';
import { defineContract } from '@darkstart/core/contract';

const Name = Type.String({ minLength: 1, maxLength: 64 });
const Greeting = Type.Object({ message: Type.String() });

export const helloContract = defineContract({
  greet: {
    method: 'GET',
    path: '/hello/:name',
    params: Type.Object({ name: Name }),
    query: Type.Object({ excited: Type.Optional(Type.Boolean()) }),
    responses: { 200: Greeting },
  },
  greetInLanguage: {
    method: 'POST',
    path: '/hello',
    body: Type.Object({ name: Name, language: Type.Union([Type.Literal('en'), Type.Literal('pt')]) }),
    responses: { 200: Greeting },
  },
});
