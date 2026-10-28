import type { TObject, TSchema } from 'typebox';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ResponseSchemas {
  readonly [status: number]: TSchema | null;
}

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly params?: TObject;
  readonly query?: TObject;
  readonly headers?: TObject;
  readonly body?: TSchema;
  readonly responses: ResponseSchemas;
}

export interface ContractRoutes {
  readonly [name: string]: RouteDefinition;
}

export interface ErrorDetail {
  readonly path: string;
  readonly message: string;
}

export interface HttpErrorOptions {
  readonly details?: readonly ErrorDetail[];
  readonly cause?: unknown;
}

export interface ErrorBody {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
}

export type EngineErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'URI_TOO_LONG'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL'
  | 'NETWORK'
  | 'INVALID_RESPONSE';

export interface Empty {
  readonly [key: string]: never;
}

export interface RouteInfo {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
}

export type PathSegment =
  | { readonly kind: 'static'; readonly text: string }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'wildcard' };
