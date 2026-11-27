// Does:  Builds the run header: recorder marker, commit, Node version, options, capacity and routes.
// Holds: The commit is read from .git files directly; no process is spawned, and no repository is not an error.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedServerOptions } from '../../server/types.ts';
import { errorCode } from './files.ts';
import { routeList } from './routes.ts';
import { DEPTH, SLOT_COUNT } from './slots.ts';
import { TRACK_COUNT } from './spans.ts';

interface GitHead {
  readonly commit: string | null;
  readonly branch: string | null;
}

export interface RunFields {
  readonly marker: string;
  readonly status: 'booting' | 'listening' | 'started' | 'closed';
  readonly startedAt: number;
  readonly listeningAt: number | null;
  readonly closedAt: number | null;
  readonly address: unknown;
  readonly readyMs: number | null;
  readonly stepN: number;
  readonly cpuN: number;
  readonly blockMs: number;
  readonly cpuStepUs: number | null;
  readonly canary: boolean;
  readonly options: ResolvedServerOptions;
}

const FORMAT = 'skeld-diag/2';
const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const REF_PREFIX = 'ref: ';
const BRANCH_PREFIX = 'refs/heads/';
const GIT_ABSENT: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EISDIR']);
const NO_HEAD: GitHead = { commit: null, branch: null };

const here = fileURLToPath(import.meta.url);
const build = here.endsWith('.ts') ? 'source' : 'dist';

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (error) {
    if (GIT_ABSENT.has(errorCode(error))) {
      return null;
    }
    throw error;
  }
}

function packedRef(gitDir: string, ref: string): string | null {
  const packed = readText(join(gitDir, 'packed-refs'));
  const line = packed?.split('\n').find((entry) => entry.endsWith(` ${ref}`));
  return line === undefined ? null : line.slice(0, line.indexOf(' '));
}

function headAt(gitDir: string, head: string): GitHead {
  if (!head.startsWith(REF_PREFIX)) {
    return { commit: OBJECT_ID.test(head) ? head : null, branch: null };
  }
  const ref = head.slice(REF_PREFIX.length);
  const commit = readText(join(gitDir, ref)) ?? packedRef(gitDir, ref);
  return {
    commit: commit !== null && OBJECT_ID.test(commit) ? commit : null,
    branch: ref.startsWith(BRANCH_PREFIX) ? ref.slice(BRANCH_PREFIX.length) : null,
  };
}

function readGitHead(): GitHead {
  let dir = dirname(here);
  for (;;) {
    const gitDir = join(dir, '.git');
    const head = readText(join(gitDir, 'HEAD'));
    if (head !== null) {
      return headAt(gitDir, head);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return NO_HEAD;
    }
    dir = parent;
  }
}

const gitHead = readGitHead();

export function runHeader(fields: RunFields): string {
  return JSON.stringify({
    format: FORMAT,
    recorder: fields.marker,
    status: fields.status,
    commit: gitHead.commit,
    branch: gitHead.branch,
    node: process.version,
    pid: process.pid,
    build,
    started_at: fields.startedAt,
    listening_at: fields.listeningAt,
    closed_at: fields.closedAt,
    address: fields.address,
    ready_ms: fields.readyMs,
    sampling: { step_n: fields.stepN, cpu_n: fields.cpuN, block_ms: fields.blockMs, cpu_step_us: fields.cpuStepUs },
    canary: fields.canary,
    options: fields.options,
    capacity: { slots: SLOT_COUNT, depth: DEPTH, tracks: TRACK_COUNT },
    routes: routeList.map(({ id, name, method, path }) => ({ id, name, method, path })),
  });
}
