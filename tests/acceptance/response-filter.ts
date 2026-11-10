import * as t from '@darkstart/core/schema';
import { defineContract } from '@darkstart/core/contract';
import { createServer } from '@darkstart/core/server';
import { check, conclude } from './support.ts';

const statement =
  'keys a handler returns that the response schema does not declare for its status never reach the wire';
const undeclaredValue = 'owner@example.com';

const contract = defineContract({
  note: {
    method: 'GET',
    path: '/note',
    responses: { 200: t.object({ id: t.string({ maxLength: 36 }), title: t.string({ maxLength: 64 }) }) },
  },
});

const server = createServer();
server.routes(contract, {
  note: () => {
    const full = { id: 'n1', title: 'First', ownerEmail: undeclaredValue };
    return { status: 200, body: full };
  },
});

const problems: string[] = [];
const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
try {
  const response = await fetch(`http://127.0.0.1:${port}/note`);
  const text = await response.text();
  check(problems, response.status === 200, `GET /note answered ${response.status}`);
  const parsed: unknown = JSON.parse(text);
  const keys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).sort() : [];
  check(problems, keys.join(',') === 'id,title', `body keys were ${keys.join(',')}: ${text}`);
  check(
    problems,
    !text.includes('ownerEmail') && !text.includes(undeclaredValue),
    `body leaked the undeclared key: ${text}`,
  );
} finally {
  await server.close();
}
conclude(statement, problems);
