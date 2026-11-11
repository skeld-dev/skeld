import type { Check, Schema } from '../schema/types.ts';
import { emitCheck } from './emit.ts';
import { emitSerializer } from './emit-serializer.ts';
import { escaped } from './escape.ts';
import type { Serializer } from './types.ts';

function isCheck(value: unknown): value is Check {
  return typeof value === 'function';
}

type MakeWrite = (escaper: typeof escaped) => Serializer['write'];

function isMakeWrite(value: unknown): value is MakeWrite {
  return typeof value === 'function';
}

function compile<F>(source: string, isMade: (made: unknown) => made is F): F {
  // biome-ignore lint/nursery/noImpliedEval: ADR-019, the one site that compiles source emitted from the declaration
  const made: unknown = new Function(`return ${source}`)();
  if (!isMade(made)) {
    throw new TypeError('the emitted source is not a function expression');
  }
  return made;
}

export function generateCheck(schema: Schema): Check {
  return compile(emitCheck(schema), isCheck);
}

export function generateSerializer(schema: Schema): Serializer {
  const { source, refusals } = emitSerializer(schema);
  return Object.freeze({ write: compile(source, isMakeWrite)(escaped), refusals: Object.freeze([...refusals]) });
}

export function probeCodegen(): EvalError | null {
  try {
    compile('function probe() {\nreturn true;\n}', isCheck);
    return null;
  } catch (error) {
    if (error instanceof EvalError) {
      return error;
    }
    throw error;
  }
}
