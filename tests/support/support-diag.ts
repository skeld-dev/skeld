// Does:  Starts a server child under the diag build and reads the three files its recorder wrote.
// Holds: The child is stopped with SIGTERM and awaited before the files are read, so the final snapshot is on disk.

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerChild } from './support-typesystem.ts';

export interface DiagChild extends ServerChild {
  dir: string;
  stopAndRead: () => Promise<DiagFiles>;
}

export interface DiagFiles {
  names: string[];
  text: string;
  journal: string;
  snapshot: string;
}

export async function startDiagChild(script: string): Promise<DiagChild> {
  const dir = mkdtempSync(join(tmpdir(), 'skeld-accept-diag-'));
  const child = spawn(process.execPath, ['--conditions=skeld-source', '--conditions=skeld-diag', script, 'serve'], {
    env: { ...process.env, SKELD_DIAG_DIR: dir, SKELD_DIAG_STEP_N: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text: string) => {
    stderr += text;
  });
  const exited = new Promise<void>((resolve) => child.on('close', () => resolve()));
  let stdout = '';
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the diag child did not report a port within 20 s')), 20_000);
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
      reject(new Error(`the diag child exited before reporting a port: ${stderr}`));
    });
  });
  const stop = async () => {
    child.kill('SIGTERM');
    await exited;
  };
  return {
    port,
    dir,
    stderr: () => stderr,
    stdout: () => stdout,
    stop,
    stopAndRead: async () => {
      await stop();
      const names = readdirSync(dir);
      const read = (name: string) => (names.includes(name) ? readFileSync(join(dir, name), 'utf8') : '');
      const files = {
        names,
        journal: read('journal.jsonl'),
        snapshot: read('snapshot.jsonl'),
        text: names.map((name) => read(name)).join('\n'),
      };
      rmSync(dir, { recursive: true });
      return files;
    },
  };
}
