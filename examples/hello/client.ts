import { createClient } from '@skeld/core/client';
import { helloContract } from './contract.ts';

const client = createClient(helloContract, { baseUrl: process.env.BASE_URL ?? 'http://127.0.0.1:3000' });

const greeting = await client.greet({ params: { name: 'Ada' }, query: { excited: true } });
const reply = await client.greetInLanguage({ body: { name: 'Ada', language: 'pt' } });

if (greeting.status === 200 && reply.status === 200) {
  process.stdout.write(`${greeting.body.message}\n${reply.body.message}\n`);
} else {
  process.stderr.write(`hello client: unexpected status (greet ${greeting.status}, greetInLanguage ${reply.status})\n`);
  process.exitCode = 1;
}
