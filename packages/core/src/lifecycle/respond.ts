import { contain, end, event, header, next, payload, start, wrote } from '#diag';
import type { Serializer } from '../compile/types.ts';
import { fail } from './error-path.ts';
import type { Exchange } from './exchange.ts';
import { ResponseContextRecord, runStage } from './hooks.ts';
import type { RuntimeReply } from './types.ts';
import { writeJson } from './wire.ts';

const NO_CONTENT = 204;
const NOT_MODIFIED = 304;
const SERIALIZATION_FAILED = 'response serialization failed';

function writePayload(exchange: Exchange, status: number, final: string | Uint8Array): void {
  if (exchange.state !== 'running') {
    return;
  }
  exchange.stage = next(exchange.stage, 'req.respond.write');
  try {
    writeJson(exchange.res, exchange.method, status, final, exchange.runtime.isClosing());
  } catch (error) {
    fail(exchange, error, true);
    return;
  }
  end(exchange.stage);
  exchange.state = 'written';
}

function writeEmpty(exchange: Exchange, status: number): void {
  const { res } = exchange;
  if (exchange.state !== 'running') {
    return;
  }
  exchange.stage = next(exchange.stage, 'req.respond.write');
  if (exchange.runtime.isClosing()) {
    res.setHeader('connection', 'close');
  }
  if (status !== NO_CONTENT && status !== NOT_MODIFIED) {
    res.setHeader('content-length', 0);
  }
  res.writeHead(status);
  res.end();
  end(exchange.stage);
  wrote(status, null, null);
  exchange.state = 'written';
}

function sendThrough(exchange: Exchange, status: number, serialized: string): void {
  const hooks = exchange.route.hooks.onSend;
  if (hooks.length === 0) {
    payload(status, serialized, serialized);
    writePayload(exchange, status, serialized);
    return;
  }
  const context = new ResponseContextRecord(exchange, status);
  contain('response', context);
  let current: string | Uint8Array = serialized;
  exchange.stage = next(exchange.stage, 'req.hook.on_send');
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
    () => {
      payload(status, serialized, current);
      writePayload(exchange, status, current);
    },
    (error) => {
      fail(exchange, error, true);
    },
  );
}

export function respond(exchange: Exchange, reply: RuntimeReply): void {
  if (exchange.state !== 'running') {
    return;
  }
  exchange.stage = next(exchange.stage, 'req.respond');
  const { res } = exchange;
  let status: number;
  let serializer: Serializer | null;
  try {
    status = reply.status;
    const declared = exchange.route.serializers.get(status);
    if (declared === undefined) {
      event('err.undeclared_status', status);
      fail(exchange, new Error(`handler returned undeclared status ${status}`), false);
      return;
    }
    serializer = declared;
    if (reply.headers !== undefined) {
      for (const [name, value] of Object.entries(reply.headers)) {
        header(name, value);
        res.setHeader(name, value);
      }
    }
  } catch (error) {
    fail(exchange, error, true);
    return;
  }
  const serialize = start('req.respond.serialize');
  let serialized: string | null;
  try {
    serialized = serializer === null ? null : serializer(reply.body);
  } catch {
    // C-79: fast-json-stringify quotes the returned value in its message, so the thrown error is never passed on.
    end(serialize);
    event('err.serialize');
    fail(exchange, new Error(SERIALIZATION_FAILED), true);
    return;
  }
  end(serialize);
  if (serialized === null) {
    writeEmpty(exchange, status);
  } else {
    sendThrough(exchange, status, serialized);
  }
}
