import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { Server } from 'node:http';
import { Socket } from 'node:net';
import { nowNs } from './clock.ts';
import { config } from './config.ts';
import { counter } from './counts.ts';
import { limitState, observe } from './limits.ts';

const SOCKET_CHANNEL = 'net.server.socket';
const REQUEST_CHANNEL = 'http.server.request.start';

const belowFloor = counter('refuse.below_floor');
const nodeAnswered = counter('refuse.node_answered');
const droppedRequest = counter('refuse.dropped_request');
const droppedConnection = counter('refuse.dropped_connection');
const headersMs = limitState('limit.headers_ms');
const connections = limitState('limit.connections');

const accepted = new WeakMap<Socket, number>();
const floor: { server: Server | null; starts: number; socketsOpen: number; awaiting: number } = {
  server: null,
  starts: 0,
  socketsOpen: 0,
  awaiting: 0,
};

const field = (message: unknown, name: string): unknown =>
  typeof message === 'object' && message !== null ? Reflect.get(message, name) : undefined;

function onSocketClose(this: Socket): void {
  floor.socketsOpen -= 1;
  if (accepted.delete(this)) {
    floor.awaiting -= 1;
    belowFloor.total += 1;
  }
}

function onSocket(message: unknown): void {
  const socket = field(message, 'socket');
  const { server } = floor;
  if (!(socket instanceof Socket) || server === null || socket.server !== server) {
    return;
  }
  accepted.set(socket, nowNs());
  floor.awaiting += 1;
  floor.socketsOpen += 1;
  socket.on('close', onSocketClose);
  observe(connections, floor.socketsOpen, Number.isFinite(server.maxConnections) ? server.maxConnections : 0, null);
}

function onRequestStart(message: unknown): void {
  if (typeof message !== 'object' || message === null || !('server' in message) || message.server !== floor.server) {
    return;
  }
  floor.starts += 1;
  if (floor.awaiting === 0) {
    return;
  }
  const socket = 'socket' in message ? message.socket : undefined;
  if (!(socket instanceof Socket)) {
    return;
  }
  const acceptedAt = accepted.get(socket);
  if (acceptedAt !== undefined) {
    accepted.delete(socket);
    floor.awaiting -= 1;
    if (config.options !== null) {
      observe(headersMs, (nowNs() - acceptedAt) / 1e6, config.options.headersTimeout, null);
    }
  }
}

function onDrop(): void {
  droppedConnection.total += 1;
}

function onDropRequest(): void {
  droppedRequest.total += 1;
}

export function watchFloor(server: Server): void {
  floor.server = server;
  subscribe(SOCKET_CHANNEL, onSocket);
  subscribe(REQUEST_CHANNEL, onRequestStart);
  server.on('drop', onDrop);
  server.on('dropRequest', onDropRequest);
}

export function unwatchFloor(): void {
  const { server } = floor;
  unsubscribe(SOCKET_CHANNEL, onSocket);
  unsubscribe(REQUEST_CHANNEL, onRequestStart);
  if (server !== null) {
    server.off('drop', onDrop);
    server.off('dropRequest', onDropRequest);
  }
}

export function settleFloor(begun: number): number {
  if (floor.server !== null) {
    nodeAnswered.total = floor.starts - begun - droppedRequest.total;
  }
  return floor.socketsOpen;
}
