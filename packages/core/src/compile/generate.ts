// Does:  Compiles the emitted check and serializer source into functions, at the one code-generation site.
// Holds: Only source emitted from the declaration is compiled here; nothing from a request ever reaches it.

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
  // Why: The emitted source is a factory that takes the escaper, so the serializer closes over it and needs no global.
  return Object.freeze({ write: compile(source, isMakeWrite)(escaped), refusals: Object.freeze([...refusals]) });
}

// Does:  Tells whether code generation is allowed: the EvalError when the runtime forbids it, null when it works.
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
