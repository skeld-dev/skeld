import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { host } from '../values.ts';
import { announceReady, failToStart, parsePort } from './server-command.ts';

const contentType = 'application/json; charset=utf-8';

const sendJson = (res: ServerResponse, value: unknown): void => {
  res.setHeader('content-type', contentType);
  res.end(JSON.stringify(value));
};

const echo = (req: IncomingMessage, res: ServerResponse): void => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    sendJson(res, JSON.parse(Buffer.concat(chunks).toString('utf8')));
  });
};

const port = parsePort(process.argv.slice(2));

const server = createServer((req, res) => {
  if (req.url === '/' && req.method === 'GET') {
    sendJson(res, { hello: 'world' });
    return;
  }
  if (req.url === '/' && req.method === 'POST') {
    echo(req, res);
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.once('error', (error) => {
  failToStart('node-http', port, error);
});

server.listen(port, host, () => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    failToStart('node-http', port, new Error('the server has no TCP address'));
  }
  announceReady('node-http', address.port);
});

const stop = (): void => {
  server.close(() => {
    process.exit(0);
  });
  server.closeAllConnections();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
