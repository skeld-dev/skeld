import { fail } from './error-path.ts';
import type { Exchange } from './exchange.ts';
import { ResponseContextRecord, runStage } from './hooks.ts';
import type { RuntimeReply } from './types.ts';
import { writeJson } from './wire.ts';

const NO_CONTENT = 204;
const NOT_MODIFIED = 304;

function writePayload(exchange: Exchange, status: number, payload: string | Uint8Array): void {
  if (exchange.state !== 'running') {
    return;
  }
  try {
    writeJson(exchange.res, exchange.method, status, payload, exchange.runtime.isClosing());
  } catch (error) {
    fail(exchange, error, true);
    return;
  }
  exchange.state = 'written';
}

function writeEmpty(exchange: Exchange, status: number): void {
  const { res } = exchange;
  if (exchange.state !== 'running') {
    return;
  }
  if (exchange.runtime.isClosing()) {
    res.setHeader('connection', 'close');
  }
  if (status !== NO_CONTENT && status !== NOT_MODIFIED) {
    res.setHeader('content-length', 0);
  }
  res.writeHead(status);
  res.end();
  exchange.state = 'written';
}

function sendThrough(exchange: Exchange, status: number, payload: string): void {
  const hooks = exchange.route.hooks.onSend;
  if (hooks.length === 0) {
    writePayload(exchange, status, payload);
    return;
  }
  const context = new ResponseContextRecord(exchange, status);
  let current: string | Uint8Array = payload;
  runStage(
    exchange,
    hooks,
    (hook) => {
      const replaced = hook(context, current);
      if (replaced instanceof Promise) {
        return replaced.then((value) => {
          if (value !== undefined) {
            current = value;
          }
        });
      }
      if (replaced !== undefined) {
        current = replaced;
      }
    },
    () => writePayload(exchange, status, current),
    (error) => fail(exchange, error, true),
  );
}

export function respond(exchange: Exchange, reply: RuntimeReply): void {
  if (exchange.state !== 'running') {
    return;
  }
  const { res } = exchange;
  let status: number;
  let payload: string | null;
  try {
    status = reply.status;
    const serializer = exchange.route.serializers.get(status);
    if (serializer === undefined) {
      fail(exchange, new Error(`handler returned undeclared status ${status}`), false);
      return;
    }
    if (reply.headers !== undefined) {
      for (const [name, value] of Object.entries(reply.headers)) {
        res.setHeader(name, value);
      }
    }
    payload = serializer === null ? null : serializer(reply.body);
  } catch (error) {
    fail(exchange, error, true);
    return;
  }
  if (payload === null) {
    writeEmpty(exchange, status);
  } else {
    sendThrough(exchange, status, payload);
  }
}
