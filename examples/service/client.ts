import { createClient } from '@skeld/core/client';
import { tasksContract } from './contract.ts';

const client = createClient(tasksContract, { baseUrl: process.env.BASE_URL ?? 'http://127.0.0.1:3002' });
const created = await client.create({ body: { title: 'Read the contract' } });
if (created.status === 409) {
  process.stdout.write(`${created.body.code}: ${created.body.message}; restart the example to clear its store\n`);
} else if (created.status === 201) {
  process.stdout.write(`Created: ${created.body.title}\n`);
  const found = await client.get({ params: { id: created.body.id } });
  if (found.status !== 200) {
    throw new Error(`Expected 200, received ${found.status}`);
  }
  process.stdout.write(`Read: ${found.body.title}; module: ${found.headers.get('x-example-module')}\n`);
} else {
  throw new Error(`Expected 201 or 409, received ${created.status}`);
}

const missing = await client.get({ params: { id: '00000000-0000-0000-0000-000000000000' } });
if (missing.status !== 404) {
  throw new Error(`Expected 404, received ${missing.status}`);
}
process.stdout.write(`Missing: ${missing.body.code}\n`);
