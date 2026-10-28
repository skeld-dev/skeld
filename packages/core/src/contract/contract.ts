import { Type } from 'typebox';
import { checkContract } from './checks.ts';
import type { ContractRoutes } from './types.ts';

export type {
  ContractRoutes,
  Empty,
  EngineErrorCode,
  ErrorBody,
  ErrorDetail,
  HttpMethod,
  ResponseSchemas,
  RouteDefinition,
} from './types.ts';

export const errorBodySchema = Type.Object({
  status: Type.Integer(),
  code: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Immutable(Type.Array(Type.Object({ path: Type.String(), message: Type.String() })))),
});

export function defineContract<const C extends ContractRoutes>(routes: C): C {
  checkContract(routes);
  return routes;
}
