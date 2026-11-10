import type { Check, Schema } from '../schema/types.ts';
import { emitCheck } from './emit.ts';

function isCheck(value: unknown): value is Check {
  return typeof value === 'function';
}

function compile(source: string): Check {
  // biome-ignore lint/nursery/noImpliedEval: ADR-019, the one site that compiles source emitted from the declaration
  const made: unknown = new Function(`return ${source}`)();
  if (!isCheck(made)) {
    throw new TypeError('the emitted source is not a function expression');
  }
  return made;
}

export function generateCheck(schema: Schema): Check {
  return compile(emitCheck(schema));
}

export function probeCodegen(): EvalError | null {
  try {
    compile('function probe() {\nreturn true;\n}');
    return null;
  } catch (error) {
    if (error instanceof EvalError) {
      return error;
    }
    throw error;
  }
}
