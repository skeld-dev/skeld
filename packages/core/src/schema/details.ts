import type { TLocalizedValidationError } from 'typebox/error';
import type { ErrorDetail } from '../contract/types.ts';
import type { PartName } from './types.ts';

export type GroupKeys = ReadonlyMap<string, ReadonlySet<string>>;

const ANY_OF_MEMBER = /\/anyOf\/\d+$/;
const CLOSING_KEYWORDS = ['additionalProperties', 'unevaluatedProperties'];

export const absentBodyDetails: readonly ErrorDetail[] = [{ path: '/body', message: 'is required' }];

export function pointerToken(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function decodeToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function perKey(path: string, keys: readonly string[], message: string): ErrorDetail[] {
  return keys.map((key) => ({ path: `${path}/${pointerToken(key)}`, message }));
}

function declaredBy(keyword: string, owner: string, groupKeys: GroupKeys): ReadonlySet<string> | undefined {
  if (keyword === 'unevaluatedProperties') {
    return groupKeys.get(owner);
  }
  return ANY_OF_MEMBER.test(owner) ? groupKeys.get(owner.slice(0, owner.lastIndexOf('/anyOf/'))) : undefined;
}

function undeclaredKeys(keyword: string, owner: string, keys: readonly string[], groupKeys: GroupKeys): string[] {
  const declared = declaredBy(keyword, owner, groupKeys);
  return keys.filter((key) => !declared?.has(key));
}

// TypeBox 1.4.3 reports an undeclared key as a `boolean` error per key, then as the keyword's key list.
function falseSchemaDetails(
  part: PartName,
  error: TLocalizedValidationError,
  groupKeys: GroupKeys,
): ErrorDetail[] | null {
  const keywordStart = error.schemaPath.lastIndexOf('/');
  const keyword = error.schemaPath.slice(keywordStart + 1);
  if (error.keyword !== 'boolean' || !CLOSING_KEYWORDS.includes(keyword)) {
    return null;
  }
  const separator = error.instancePath.lastIndexOf('/');
  const key = decodeToken(error.instancePath.slice(separator + 1));
  const undeclared = undeclaredKeys(keyword, error.schemaPath.slice(0, keywordStart), [key], groupKeys);
  return perKey(`/${part}${error.instancePath.slice(0, separator)}`, undeclared, 'is not allowed');
}

export function toErrorDetails(
  part: PartName,
  errors: readonly TLocalizedValidationError[],
  groupKeys: GroupKeys,
): ErrorDetail[] {
  const details = errors.flatMap((error) => {
    const falseSchema = falseSchemaDetails(part, error, groupKeys);
    if (falseSchema !== null) {
      return falseSchema;
    }
    const path = `/${part}${error.instancePath}`;
    if (error.keyword === 'required') {
      return perKey(path, error.params.requiredProperties, 'is required');
    }
    if (error.keyword === 'additionalProperties') {
      const keys = error.params.additionalProperties;
      return perKey(path, undeclaredKeys(error.keyword, error.schemaPath, keys, groupKeys), 'is not allowed');
    }
    if (error.keyword === 'unevaluatedProperties') {
      const keys = error.params.unevaluatedProperties.map(String);
      return perKey(path, undeclaredKeys(error.keyword, error.schemaPath, keys, groupKeys), 'is not allowed');
    }
    return [{ path, message: error.message }];
  });
  const seen = new Set<string>();
  return details.filter((detail) => {
    const key = JSON.stringify([detail.path, detail.message]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
