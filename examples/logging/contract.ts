import { defineContract } from '@skeld/core/contract';
import * as t from '@skeld/core/schema';

export const previewContract = defineContract({
  preview: {
    method: 'POST',
    path: '/preview',
    body: t.object({
      email: t.string({ minLength: 1, maxLength: 254, sensitivity: 'personal' }),
      apiKey: t.string({ minLength: 1, maxLength: 128, sensitivity: 'secret' }),
      document: t.string({ minLength: 1, maxLength: 512, sensitivity: 'personal' }),
    }),
    responses: {
      200: t.object({ accepted: t.literal(true) }),
      422: t.object({ code: t.literal('INVALID_DOCUMENT') }),
    },
  },
});
