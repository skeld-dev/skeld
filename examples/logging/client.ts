import { createClient } from '@skeld/core/client';
import { previewContract } from './contract.ts';

const client = createClient(previewContract, { baseUrl: process.env.BASE_URL ?? 'http://127.0.0.1:3001' });
const input = { email: 'reader@example.test', apiKey: 'demo-key-only-not-a-credential' };

const accepted = await client.preview({ body: { ...input, document: '{"draft":true}' } });
if (accepted.status !== 200) {
  throw new Error(`Expected 200, received ${accepted.status}`);
}
process.stdout.write(`Accepted: ${accepted.body.accepted}; request id: ${accepted.headers.get('x-request-id')}\n`);

const rejected = await client.preview({ body: { ...input, document: 'PRIVATE_DOCUMENT_NOT_JSON' } });
if (rejected.status !== 422) {
  throw new Error(`Expected 422, received ${rejected.status}`);
}
process.stdout.write(`Rejected: ${rejected.body.code}; request id: ${rejected.headers.get('x-request-id')}\n`);
