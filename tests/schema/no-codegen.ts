// Does:  Proves that the closure check and the client work where code generation from strings is forbidden.
// Holds: Run under --disallow-code-generation-from-strings; listen itself must reject with CODEGEN_UNAVAILABLE.

import { createClient } from '@darkstart/core/client';
import { defineContract } from '@darkstart/core/contract';
import * as t from '@darkstart/core/schema';
import { invalidValue, sample, schemas, shapes } from './diverse-fixture.ts';

const flag = '--disallow-code-generation-from-strings';

const helloContract = defineContract({
  greet: {
    method: 'GET',
    path: '/hello/:name',
    params: t.object({ name: t.string({ minLength: 1, maxLength: 64 }) }),
    query: t.object({ excited: t.optional(t.boolean()) }),
    responses: { 200: t.object({ message: t.string({ maxLength: 200 }) }) },
  },
  greetInLanguage: {
    method: 'POST',
    path: '/hello',
    body: t.object({
      name: t.string({ minLength: 1, maxLength: 64 }),
      language: t.union([t.literal('en'), t.literal('pt')]),
    }),
    responses: { 200: t.object({ message: t.string({ maxLength: 200 }) }) },
  },
});

function codegenBlocked(): boolean {
  try {
    Reflect.construct(Function, ['return 1'])();
    return false;
  } catch (error) {
    if (error instanceof EvalError) {
      return true;
    }
    throw error;
  }
}

function answer(body: unknown): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
}

interface Report {
  readonly name: string;
  readonly problems: string[];
  readonly figures: Readonly<Record<string, number | string>>;
}

function closureHalf(): Report {
  const problems: string[] = [];
  let evalErrors = 0;
  let accepted = 0;
  let refused = 0;
  schemas.forEach((schema, index) => {
    const shape = shapes[index];
    try {
      if (!('value' in schema['~standard'].validate(sample(index)))) {
        problems.push(`schema ${index}: its valid sample was refused`);
      }
      accepted++;
      for (let variant = 0; shape !== undefined && variant < 5; variant++) {
        if ('value' in schema['~standard'].validate(invalidValue(sample(index), shape, variant))) {
          problems.push(`schema ${index}: invalid variant ${variant} was accepted`);
        } else {
          refused++;
        }
      }
    } catch (error) {
      if (error instanceof EvalError) {
        evalErrors++;
      } else {
        problems.push(`schema ${index}: ${String(error)}`);
      }
    }
  });
  if (evalErrors > 0) {
    problems.push(`${evalErrors} EvalError`);
  }
  return {
    name: 'the closure evaluator validates the 400 diverse schemas with 0 EvalError',
    problems,
    figures: { schemas: schemas.length, validAccepted: accepted, invalidRefused: refused, evalErrors },
  };
}

async function clientHalf(): Promise<Report> {
  const problems: string[] = [];
  let evalErrors = 0;
  const note = (error: unknown): void => {
    if (error instanceof EvalError) {
      evalErrors++;
    } else {
      problems.push(String(error));
    }
  };
  const good = createClient(helloContract, { baseUrl: 'http://127.0.0.1:1', fetch: answer({ message: 'Hello, Ada' }) });
  try {
    const result = await good.greet({ params: { name: 'Ada' }, query: {} });
    if (result.status !== 200 || result.body.message !== 'Hello, Ada') {
      problems.push('a well-shaped 200 did not resolve typed');
    }
  } catch (error) {
    note(error);
  }
  const wrong = createClient(helloContract, { baseUrl: 'http://127.0.0.1:1', fetch: answer({ message: 7 }) });
  try {
    await wrong.greet({ params: { name: 'Ada' }, query: {} });
    problems.push('a wrong-shaped 200 was accepted by the client');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'INVALID_RESPONSE') {
      note(error);
    }
  }
  if (evalErrors > 0) {
    problems.push(`${evalErrors} EvalError`);
  }
  return {
    name: 'createClient and one response validation run with 0 EvalError',
    problems,
    figures: { evalErrors },
  };
}

async function listenHalf(disabled: boolean): Promise<Report> {
  const problems: string[] = [];
  const name = disabled
    ? `listen of the hello contract rejects with CODEGEN_UNAVAILABLE naming ${flag}`
    : 'listen of the hello contract succeeds without the flag';
  let modules: [typeof import('@darkstart/core/server'), typeof import('@darkstart/core/boot-error')];
  try {
    modules = await Promise.all([import('@darkstart/core/server'), import('@darkstart/core/boot-error')]);
  } catch (error) {
    return { name, problems: [`the server could not be loaded: ${String(error).slice(0, 200)}`], figures: {} };
  }
  const [{ createServer }, { BootError }] = modules;
  const server = createServer();
  server.routes(helloContract, {
    greet: ({ params }) => ({ status: 200, body: { message: `Hello, ${params.name}` } }),
    greetInLanguage: ({ body }) => ({ status: 200, body: { message: `Hello, ${body.name}` } }),
  });
  let outcome = 'listened';
  try {
    await server.listen({ port: 0, host: '127.0.0.1' });
    await server.close();
  } catch (error) {
    outcome = error instanceof BootError ? `${error.code}: ${error.message}` : String(error);
  }
  if (disabled) {
    if (!outcome.startsWith('CODEGEN_UNAVAILABLE') || !outcome.includes(flag)) {
      problems.push(`listen under the flag answered "${outcome.slice(0, 160)}"`);
    }
  } else if (outcome !== 'listened') {
    problems.push(`listen without the flag answered "${outcome.slice(0, 160)}"`);
  }
  return {
    name,
    problems,
    figures: { outcome: outcome.slice(0, 80) },
  };
}

function print(report: Report): void {
  const verdict = report.problems.length === 0 ? 'pass' : 'fail';
  process.stdout.write(`${verdict} ${report.name} ${JSON.stringify(report.figures)}\n`);
  for (const problem of report.problems.slice(0, 10)) {
    process.stdout.write(`  ${problem}\n`);
  }
}

async function main(): Promise<void> {
  const blocked = codegenBlocked();
  process.stdout.write(`mode: code generation from strings is ${blocked ? 'disabled' : 'enabled'} (probe call)\n`);
  const closure = closureHalf();
  print(closure);
  const client = await clientHalf();
  print(client);
  const listen = await listenHalf(blocked);
  print(listen);
  const reports = [closure, client, listen];
  if (reports.some((report) => report.problems.length > 0)) {
    process.exitCode = 1;
  }
}

await main();
