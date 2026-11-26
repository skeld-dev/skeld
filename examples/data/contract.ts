import { defineContract, errorBodySchema } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

const accountId = t.string({ minLength: 1, maxLength: 64 });
const amount = t.integer({ minimum: 1, maximum: 1_000_000 });

// The row schema of a query and the body of a response: one declaration for both.
export const Account = t.object({
  id: accountId,
  balance: t.integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
});

const Transfer = t.object({
  id: t.string({ minLength: 36, maxLength: 36 }),
  from: accountId,
  to: accountId,
  amount,
});

export const bankContract = defineContract({
  listAccounts: {
    method: 'GET',
    path: '/accounts',
    responses: { 200: t.object({ accounts: t.array(Account, { maxItems: 100 }) }) },
  },
  getAccount: {
    method: 'GET',
    path: '/accounts/:id',
    params: t.object({ id: accountId }),
    responses: { 200: Account, 404: errorBodySchema },
  },
  createTransfer: {
    method: 'POST',
    path: '/transfers',
    body: t.object({ from: accountId, to: accountId, amount }),
    responses: { 201: Transfer, 404: errorBodySchema, 409: errorBodySchema, 429: errorBodySchema },
  },
});
