import { compileCheck, type DeclaredProperty, declaredProperties, isObjectValue, readDeclared } from './check.ts';
import { isModelSchema, type ModelSchema } from './node.ts';
import { Secret } from './secret.ts';
import type {
  ArraySchema,
  Check,
  Finish,
  FinishMode,
  ObjectSchema,
  RecordSchema,
  Schema,
  Sensitivity,
  UnionSchema,
} from './types.ts';

interface FinishedProperty {
  readonly property: DeclaredProperty;
  readonly finish: Finish | null;
}

interface FinishedMember {
  readonly check: Check;
  readonly finish: Finish | null;
}

const finishes: Readonly<Record<FinishMode, WeakMap<Schema, Finish | null>>> = {
  wrap: new WeakMap(),
  raw: new WeakMap(),
};

function sealed(sensitivity: Sensitivity | undefined, mode: FinishMode, inner: Finish | null): Finish | null {
  if (mode !== 'wrap' || sensitivity !== 'secret') {
    return inner;
  }
  if (inner === null) {
    return (value) => new Secret(value);
  }
  return (value) => new Secret(inner(value));
}

function openFinish(properties: readonly FinishedProperty[]): Finish {
  return (value) => {
    if (!isObjectValue(value)) {
      return value;
    }
    const entries: [string, unknown][] = [];
    for (const { property, finish } of properties) {
      const item = readDeclared(value, property);
      if (item !== undefined) {
        entries.push([property.key, finish === null ? item : finish(item)]);
      }
    }
    return Object.fromEntries(entries);
  };
}

function objectFinish(schema: ObjectSchema, mode: FinishMode): Finish | null {
  const properties = declaredProperties(schema).map((property) => ({
    property,
    finish: compileFinish(property.schema, mode),
  }));
  if (schema.open !== undefined) {
    return openFinish(properties);
  }
  const changing: { readonly property: DeclaredProperty; readonly finish: Finish }[] = [];
  for (const { property, finish } of properties) {
    if (finish !== null) {
      changing.push({ property, finish });
    }
  }
  if (changing.length === 0) {
    return null;
  }
  return (value) => {
    if (!isObjectValue(value)) {
      return value;
    }
    let copy: Record<string, unknown> | null = null;
    for (const { property, finish } of changing) {
      const item = readDeclared(value, property);
      if (item === undefined) {
        continue;
      }
      const finished = finish(item);
      if (finished !== item) {
        copy ??= { ...value };
        Object.defineProperty(copy, property.key, {
          value: finished,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
    return copy ?? value;
  };
}

function arrayFinish(schema: ArraySchema, mode: FinishMode): Finish | null {
  const itemFinish = compileFinish(schema.items, mode);
  if (itemFinish === null) {
    return null;
  }
  return (value) => (Array.isArray(value) ? value.map((item: unknown) => itemFinish(item)) : value);
}

function recordFinish(schema: RecordSchema, mode: FinishMode): Finish | null {
  const valueFinish = compileFinish(schema.value, mode);
  if (valueFinish === null) {
    return null;
  }
  return (value) => {
    if (!isObjectValue(value)) {
      return value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, valueFinish(item)]));
  };
}

function unionFinish(schema: UnionSchema, mode: FinishMode): Finish | null {
  const members: FinishedMember[] = schema.members.map((member) => ({
    check: compileCheck(member),
    finish: compileFinish(member, mode),
  }));
  if (members.every((member) => member.finish === null)) {
    return null;
  }
  return (value) => {
    for (const member of members) {
      if (member.check(value)) {
        return member.finish === null ? value : member.finish(value);
      }
    }
    return value;
  };
}

function buildFinish(schema: ModelSchema, mode: FinishMode): Finish | null {
  switch (schema.kind) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
      return sealed(schema.sensitivity, mode, null);
    case 'literal':
      return null;
    case 'object':
      return sealed(schema.sensitivity, mode, objectFinish(schema, mode));
    case 'array':
      return sealed(schema.sensitivity, mode, arrayFinish(schema, mode));
    case 'record':
      return sealed(schema.sensitivity, mode, recordFinish(schema, mode));
    case 'union':
      return sealed(schema.sensitivity, mode, unionFinish(schema, mode));
    case 'optional':
      return compileFinish(schema.inner, mode);
    case 'exposed':
      return compileFinish(schema.inner, 'raw');
  }
}

export function compileFinish(schema: Schema, mode: FinishMode): Finish | null {
  if (!isModelSchema(schema)) {
    return null;
  }
  const cache = finishes[mode];
  const cached = cache.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  if (cache.has(schema)) {
    return null;
  }
  const finish = buildFinish(schema, mode);
  cache.set(schema, finish);
  return finish;
}
