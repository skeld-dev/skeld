// Does:  Proves per-route body limits reject unknown own keys and still enforce valid limits on the wire.
// Holds: A refused registration is atomic, inherited options are ignored and prototype names remain valid routes.

import assert from 'node:assert/strict';
import { BootError } from '@darkstart/core/boot-error';
import { defineContract } from '@darkstart/core/contract';
import * as t from '@darkstart/core/schema';
import { createServer } from '@darkstart/core/server';

const body = t.object({ text: t.string({ maxLength: 256 }) });
const contract = defineContract({
  item: { method: 'POST', path: '/item', body, responses: { 204: null } },
  second: { method: 'POST', path: '/second', body, responses: { 204: null } },
});
let calls = 0;
const handler = () => {
  calls++;
  return { status: 204 as const };
};
const handlers = { item: handler, second: handler };
const server = createServer({ bodyLimit: 1024 });
const prototypeNames = Object.getOwnPropertyNames(Object.prototype);

try {
  for (const name of ['ghost', ...prototypeNames]) {
    for (const value of [64, undefined]) {
      const bodyLimits = { item: 64, [name]: value };
      assert.throws(
        () => server.routes(contract, handlers, { bodyLimits }),
        (error: unknown) =>
          error instanceof BootError &&
          error.code === 'INVALID_OPTION' &&
          error.message.includes(`bodyLimits.${name}: no such route`),
        `unknown own option ${name}=${String(value)} must be refused synchronously`,
      );
    }
  }

  const inherited = Object.create({ ghost: 1, item: 1 });
  Object.defineProperty(inherited, 'second', { value: 64, enumerable: true });
  server.routes(contract, handlers, { bodyLimits: inherited });
  for (const [index, name] of prototypeNames.entries()) {
    const named = defineContract({
      [name]: { method: 'POST', path: `/prototype/${index}`, body, responses: { 204: null } },
    });
    server.routes(named, { [name]: handler }, { bodyLimits: { [name]: 64 } });
  }

  const { port } = await server.listen({ port: 0, host: '127.0.0.1' });
  const send = (path: string, size: number) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ text: 'x'.repeat(size) }),
    });
  const inheritedIgnored = await send('/item', 80);
  assert.equal(inheritedIgnored.status, 204, 'an inherited limit must not override the default');
  await inheritedIgnored.text();
  const accepted = await send('/second', 4);
  assert.equal(accepted.status, 204, 'valid retry must register both routes exactly once');
  await accepted.text();
  const before = calls;
  const refused = await send('/second', 80);
  assert.equal(refused.status, 413);
  await refused.text();
  assert.equal(calls, before, 'a route body cap must refuse before its handler');
  const named = await send(`/prototype/${prototypeNames.indexOf('constructor')}`, 4);
  assert.equal(named.status, 204, 'an own prototype-name route and limit must remain usable');
  await named.text();
} finally {
  await server.close();
}
process.stdout.write(
  'pass body limit options: own unknown keys refused, atomic retry, inherited keys ignored, valid cap enforced\n',
);
