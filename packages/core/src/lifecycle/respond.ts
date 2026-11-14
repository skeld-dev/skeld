// Does:  Serializes the handler's reply for its declared status, runs the onSend hooks and writes it.
// Holds: Only the serializer's text is written; a schema mismatch becomes the fixed 500 and no hook replaces it.

import type { OutgoingHttpHeaders } from 'node:http';
import { contain, end, event, next, payload, start, wrote } from '#diag';
import type { Serializer } from '../compile/types.ts';
import { setAuthorHeaders } from './author-header.ts';
import { collectCookies } from './cookies.ts';
import { settle } from './deadline.ts';
import { engineFault, type FaultDetail } from './engine-fault.ts';
import { fail } from './error-path.ts';
import type { Exchange } from './exchange.ts';
import { ResponseContextRecord, runStage } from './hooks.ts';
import type { RuntimeReply } from './types.ts';
import { finishHead } from './head.ts';
import { writeJson } from './wire.ts';

const NO_CONTENT = 204;
const NOT_MODIFIED = 304;
const SCHEMA_MISMATCH = 'response does not match its schema';
// Why: A three-digit integer is the most a status line can carry, so the logged value is bounded whatever was returned.
const FIRST_LOGGED_STATUS = 100;
const LAST_LOGGED_STATUS = 999;

function mismatch(location: string | undefined): Error {
  if (location === undefined || location === '') {
    return engineFault('response_mismatch', SCHEMA_MISMATCH, null);
  }
  return engineFault('response_mismatch', `${SCHEMA_MISMATCH} at ${location}`, ['skeld.schema_location', location]);
}

function writePayload(exchange: Exchange, status: number, serialized: string): void {
  if (exchange.state !== 'running') {
    return;
  }
  exchange.stage = next(exchange.stage, 'req.respond.write');
  try {
    const { runtime } = exchange;
    writeJson(
      exchange.res,
      exchange.log.id,
      exchange.method,
      status,
      serialized,
      runtime.isClosing(),
      runtime.securityHeaders,
      exchange.route,
      exchange.pendingCookies,
      exchange.cors,
    );
  } catch (error) {
    fail(exchange, error);
    return;
  }
  end(exchange.stage);
  settle(exchange, 'written');
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
  // Why: A 204 must not carry Content-Length (RFC 9110 section 8.6), and a 304's would describe the full response.
  if (status !== NO_CONTENT && status !== NOT_MODIFIED) {
    res.setHeader('content-length', 0);
  }
  const head: OutgoingHttpHeaders = {};
  try {
    finishHead(
      res,
      exchange.log.id,
      status,
      head,
      exchange.runtime.securityHeaders,
      exchange.route,
      exchange.pendingCookies,
      exchange.cors,
    );
  } catch (error) {
    fail(exchange, error);
    return;
  }
  res.writeHead(status, head);
  res.end();
  end(exchange.stage);
  wrote(status, head, null);
  settle(exchange, 'written');
}

// Does:  Shows the serialized text to the onSend hooks, then writes it; whatever a hook returns is ignored.
function sendThrough(exchange: Exchange, status: number, serialized: string): void {
  const hooks = exchange.route.hooks.onSend;
  if (hooks.length === 0) {
    payload(status, serialized);
    writePayload(exchange, status, serialized);
    return;
  }
  const context = new ResponseContextRecord(exchange, status);
  contain('response', context);
  exchange.stage = next(exchange.stage, 'req.hook.on_send');
  runStage(
    exchange,
    hooks,
    (hook) => hook(context, serialized),
    () => {
      payload(status, serialized);
      writePayload(exchange, status, serialized);
    },
    (error) => {
      fail(exchange, error);
    },
  );
}

// Does:  Writes the handler's reply; an undeclared status or a schema mismatch goes to the error path instead.
export function respond(exchange: Exchange, reply: RuntimeReply): void {
  if (exchange.state !== 'running') {
    return;
  }
  exchange.stage = next(exchange.stage, 'req.respond');
  const { res } = exchange;
  let status: number;
  let serializer: Serializer | null;
  try {
    // Why: The reply is the author's object; reading it can run a getter that throws.
    status = reply.status;
    const declared = exchange.route.serializers.get(status);
    if (declared === undefined) {
      event('err.undeclared_status', status);
      const logged = Number.isInteger(status) && status >= FIRST_LOGGED_STATUS && status <= LAST_LOGGED_STATUS;
      const detail: FaultDetail | null = logged ? ['skeld.returned_status', status] : null;
      fail(exchange, engineFault('undeclared_status', `handler returned undeclared status ${status}`, detail));
      return;
    }
    serializer = declared;
    if (reply.headers !== undefined) {
      setAuthorHeaders(res, reply.headers);
    }
    const { cookies } = reply;
    if (cookies !== undefined) {
      exchange.pendingCookies = collectCookies(exchange.pendingCookies, cookies);
    }
  } catch (error) {
    fail(exchange, error);
    return;
  }
  const serialize = start('req.respond.serialize');
  if (serializer === null) {
    end(serialize);
    writeEmpty(exchange, status);
    return;
  }
  let written: string | number;
  try {
    written = serializer.write(reply.body);
  } catch (error) {
    end(serialize);
    event('err.serialize');
    fail(exchange, error);
    return;
  }
  end(serialize);
  // Why: A number is the index of the schema location that refused the value, never the value itself.
  if (typeof written === 'number') {
    event('err.serialize');
    fail(exchange, mismatch(serializer.refusals[written]));
    return;
  }
  sendThrough(exchange, status, written);
}
