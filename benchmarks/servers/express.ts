// Does:  Serves the hello and echo routes with Express, for comparison.
// Holds: It serves the same two routes with the same bodies as every other server here.

import express from 'express';
import { host } from '../values.ts';
import { announceReady, failToStart, parsePort } from './server-command.ts';

const port = parsePort(process.argv.slice(2));
const app = express();

app.get('/', (_req, res) => {
  res.json({ hello: 'world' });
});

app.post('/', express.json(), (req, res) => {
  // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- echo route: res.json writes the parsed JSON body as application/json
  res.json(req.body);
});

const server = app.listen(port, host, (error) => {
  if (error !== undefined) {
    failToStart('express', port, error);
  }
  const address = server.address();
  if (address === null || typeof address === 'string') {
    failToStart('express', port, new Error('the server has no TCP address'));
  }
  announceReady('express', address.port);
});

const stop = (): void => {
  server.close(() => {
    process.exit(0);
  });
  server.closeAllConnections();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
