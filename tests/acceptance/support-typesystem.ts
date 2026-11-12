// Does:  Starts a server child for the type-system scripts and gives them raw-socket helpers.
// Holds: A child that reports no port within 20 s fails the script instead of hanging it.

import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseRaw, type RawResponse } from './support.ts';

export interface Exchange {
  socket: net.Socket;
  closed: Promise<void>;
  response: () => RawResponse;
  bytesReceived: () => number;
}

export function openSocket(port: number): Exchange {
  const socket = net.connect(port, '127.0.0.1');
  const chunks: Buffer[] = [];
  socket.on('data', (data) => chunks.push(Buffer.from(data)));
  socket.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  return {
    socket,
    closed,
    response: () => parseRaw(Buffer.concat(chunks).toString('latin1')),
    bytesReceived: () => chunks.reduce((total, chunk) => total + chunk.length, 0),
  };
}

export function flush(socket: net.Socket, data: string | Buffer): Promise<void> {
  return new Promise((resolve) => socket.write(data, () => resolve()));
}

export async function settle(exchange: Exchange, waitMs = 3000): Promise<RawResponse> {
  await Promise.race([exchange.closed, delay(waitMs, undefined, { ref: false })]);
  exchange.socket.destroy();
  return exchange.response();
}

export function chunked(data: string | Buffer): Buffer {
  const body = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  return Buffer.concat([Buffer.from(`${body.length.toString(16)}\r\n`, 'latin1'), body, Buffer.from('\r\n', 'latin1')]);
}

export interface ServerChild {
  port: number;
  stderr: () => string;
  stop: () => Promise<void>;
}

export async function startServerChild(script: string): Promise<ServerChild> {
  const child = spawn(process.execPath, ['--conditions=skeld-source', script, 'serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text: string) => {
    stderr += text;
  });
  const exited = new Promise<void>((resolve) => child.on('close', () => resolve()));
  const port = await new Promise<number>((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error('the server child did not report a port within 20 s')), 20_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      stdout += text;
      const match = /^listening (\d+)$/m.exec(stdout);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('close', () => {
      clearTimeout(timer);
      reject(new Error(`the server child exited before reporting a port: ${stderr}`));
    });
  });
  return {
    port,
    stderr: () => stderr,
    stop: async () => {
      child.kill('SIGTERM');
      await exited;
    },
  };
}
