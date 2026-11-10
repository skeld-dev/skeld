import { end, limit, start } from '#diag';
import type { ErrorDetail, RouteDefinition } from '../contract/types.ts';
import { explain } from '../schema/explain.ts';
import { compileFinish } from '../schema/finish.ts';
import { isRequired } from '../schema/messages.ts';
import { toPointer } from '../schema/pointer.ts';
import type { Check, Finish, Issue, ObjectSchema, Schema } from '../schema/types.ts';
import { SchemaCompileError } from './compile-error.ts';
import { compileProjection } from './convert.ts';
import { generateCheck } from './generate.ts';
import type { PartName, PartOutcome, PartValidator, RequestValidators } from './types.ts';

interface CompiledSchema {
  readonly schema: Schema;
  readonly check: Check;
  readonly finish: Finish | null;
}

// C-13 writes 100 entries; the 101st tells the lifecycle that more failed.
const MAX_DETAILS = 101;

const absentBody: PartOutcome = { kind: 'failed', details: [{ path: '/body', message: isRequired }] };

const checks = new WeakMap<Schema, Check>();

function collectIssues(schema: Schema, value: unknown): readonly Issue[] {
  const span = start('req.validate.errors');
  try {
    const issues = explain(schema, value, MAX_DETAILS);
    limit('limit.raw_errors', issues.length, MAX_DETAILS);
    return issues;
  } finally {
    end(span);
  }
}

function validate(part: PartName, compiled: CompiledSchema, value: unknown): PartOutcome {
  if (compiled.check(value)) {
    return { kind: 'ok', value: compiled.finish === null ? value : compiled.finish(value) };
  }
  const details: ErrorDetail[] = collectIssues(compiled.schema, value).map((issue) => ({
    path: `/${part}${toPointer(issue.path)}`,
    message: issue.message,
  }));
  return { kind: 'failed', details };
}

function checkOf(schema: Schema): Check {
  const cached = checks.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const check = generateCheck(schema);
  checks.set(schema, check);
  return check;
}

function compileSchema(schema: Schema): CompiledSchema {
  return { schema, check: checkOf(schema), finish: compileFinish(schema, 'wrap') };
}

function keyedValidator(part: PartName, schema: ObjectSchema): PartValidator {
  const compiled = compileSchema(schema);
  const project = compileProjection(schema);
  return { run: (raw) => validate(part, compiled, project(raw)) };
}

function bodyValidator(schema: Schema): PartValidator {
  const compiled = compileSchema(schema);
  return { run: (value) => (value === undefined ? absentBody : validate('body', compiled, value)) };
}

function compilePart<S extends Schema>(
  part: PartName,
  schema: S | undefined,
  compile: (schema: S) => PartValidator,
): PartValidator | null {
  if (schema === undefined) {
    return null;
  }
  try {
    return compile(schema);
  } catch (cause) {
    if (cause instanceof EvalError) {
      throw cause;
    }
    throw new SchemaCompileError(part, null, cause);
  }
}

export function compileRequestValidators(route: RouteDefinition): RequestValidators {
  return {
    params: compilePart('params', route.params, (schema) => keyedValidator('params', schema)),
    query: compilePart('query', route.query, (schema) => keyedValidator('query', schema)),
    headers: compilePart('headers', route.headers, (schema) => keyedValidator('headers', schema)),
    body: compilePart('body', route.body, bodyValidator),
  };
}
