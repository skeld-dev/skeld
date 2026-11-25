import { CSRF_TOKEN_HEADER } from '@skeld/core/gate';
import { createOpenApi, type SecurityRequirement } from '@skeld/openapi';
import { notesContract, SESSION_COOKIE } from './service.ts';

// A session read needs the cookie; a session write needs the cookie AND the CSRF header, in one alternative.
// An API key in the Authorization header is the other alternative of both.
const sessionRead: SecurityRequirement = { session: [] };
const sessionWrite: SecurityRequirement = { session: [], csrf: [] };
const apiKey: SecurityRequirement = { apiKey: [] };

const { document, diagnostics } = createOpenApi(notesContract, {
  info: { title: 'Notes', version: '1.0.0', description: 'Notes, read and written by their owner.' },
  securitySchemes: {
    session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
    csrf: { type: 'apiKey', in: 'header', name: CSRF_TOKEN_HEADER },
    apiKey: { type: 'http', scheme: 'bearer', description: 'An API key issued by the service.' },
  },
  routes: {
    health: { summary: 'Check the service is up' },
    readNote: { summary: 'Read a note', security: [sessionRead, apiKey], responses: { 404: 'No such note' } },
    writeNote: { summary: 'Replace a note', security: [sessionWrite, apiKey], responses: { 404: 'No such note' } },
  },
});

// The library writes nothing: printing the document is this script's choice.
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
for (const { code, location, message } of diagnostics) {
  process.stderr.write(`${code} ${location.join('.')}: ${message}\n`);
}
