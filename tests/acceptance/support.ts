import net from 'node:net';

export interface RawResponse {
  status: number;
  headers: Map<string, string>;
  body: string;
  raw: string;
}

export function parseRaw(raw: string): RawResponse {
  const split = raw.indexOf('\r\n\r\n');
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? '' : raw.slice(split + 4);
  const [statusLine = '', ...headerLines] = head.split('\r\n');
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return { status: Number(statusLine.split(' ')[1]), headers, body, raw };
}

export function rawExchange(port: number, request: string, waitMs = 3000): Promise<RawResponse> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(parseRaw(Buffer.concat(chunks).toString('latin1')));
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('data', (data) => chunks.push(Buffer.from(data)));
    socket.on('close', finish);
    socket.on('error', () => undefined);
    socket.write(request, 'latin1');
  });
}

export function check(problems: string[], condition: boolean, message: string): void {
  if (!condition) {
    problems.push(message);
  }
}

export function conclude(statement: string, problems: string[]): void {
  if (problems.length === 0) {
    process.stdout.write(`pass ${statement}\n`);
    return;
  }
  process.stdout.write(`fail ${problems.join('; ')}\n`);
  process.exitCode = 1;
}
