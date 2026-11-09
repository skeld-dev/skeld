import { IncomingMessage, type Server, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { ContextKind } from '../empty.ts';
import { type Counter, keyedCounter } from './counts.ts';
import { raise } from './events.ts';
import { type SlotRecord, state } from './slots.ts';

const contextCounters = new Map<ContextKind, Counter>();
const socketBaselines = new WeakMap<Socket, number>();
const watched: { server: Server | null; serverRequest: number } = { server: null, serverRequest: 0 };

export const listenerGauge = { server_request: 0, socket_listeners_peak: 0 };

function contextCounter(kind: ContextKind): Counter {
  const found = contextCounters.get(kind);
  if (found !== undefined) {
    return found;
  }
  const created = keyedCounter('req.hook.context', kind);
  contextCounters.set(kind, created);
  return created;
}

const reachesRaw = (held: unknown): boolean =>
  held instanceof IncomingMessage || held instanceof ServerResponse || held instanceof Socket;

export function checkContain(kind: ContextKind, value: object): void {
  contextCounter(kind).total += 1;
  const record = state.current;
  if (record === null || !record.step) {
    return;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && reachesRaw(descriptor.value)) {
      const subject = typeof key === 'string' ? key : (key.description ?? 'symbol');
      raise('contain.raw_request', subject, record.route?.name ?? null, null);
      return;
    }
  }
}

export function watchServer(server: Server | null): void {
  watched.server = server;
  if (server !== null) {
    watched.serverRequest = server.listenerCount('request');
    listenerGauge.server_request = watched.serverRequest;
  }
}

export function checkListeners(record: SlotRecord): void {
  const route = record.route?.name ?? null;
  const socket = record.req?.socket;
  if (socket !== undefined) {
    let total = 0;
    for (const name of socket.eventNames()) {
      total += socket.listenerCount(name);
    }
    const first = socketBaselines.get(socket);
    if (first === undefined || total > first) {
      socketBaselines.set(socket, total);
    }
    if (first !== undefined && total > first) {
      raise('contain.listeners', 'socket', route, null);
    }
    if (total > listenerGauge.socket_listeners_peak) {
      listenerGauge.socket_listeners_peak = total;
    }
  }
  const { server } = watched;
  if (server !== null) {
    const count = server.listenerCount('request');
    listenerGauge.server_request = count;
    if (count !== watched.serverRequest) {
      watched.serverRequest = count;
      raise('contain.listeners', 'server_request', route, null);
    }
  }
}
