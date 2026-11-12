// Does:  Declares the contract's shapes: routes, response schemas, the error body and the engine's error codes.
// Holds: The error body is exactly status, code, message and optional details; nothing else is ever on the wire.

import type { ObjectSchema, Schema } from '../schema/types.ts';

/** The HTTP methods a route can declare. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A route's responses by status: a schema for a body, `null` for none.
 * Statuses run from 200 to 599; 204 and 304 must be `null`; at least one is declared.
 */
export interface ResponseSchemas {
  readonly [status: number]: Schema | null;
}

/** One route of a contract: its method, its path and the schemas of its request parts and responses. */
export interface RouteDefinition {
  /** The HTTP method; a HEAD request is served by the GET route of the same path. */
  readonly method: HttpMethod;
  /**
   * The path pattern: static segments, `:name` parameters and a final `*` wildcard.
   * It starts with `/` and holds no empty segment, `?`, `#`, `%` or whitespace.
   */
  readonly path: string;
  /**
   * The path parameters' schema: one key per `:name` segment, and `*` for the wildcard.
   * Each property is a string, number, integer, boolean or literal schema, a union of them, or one of these optional.
   */
  readonly params?: ObjectSchema;
  /**
   * The query string's schema; the handler receives only the declared keys and others are ignored.
   * Each property is a scalar schema as in `params`, or an array of them.
   */
  readonly query?: ObjectSchema;
  /**
   * The request headers' schema, with lower-case keys; the handler receives only the declared ones.
   * Each property is a scalar schema as in `params`.
   */
  readonly headers?: ObjectSchema;
  /**
   * The JSON body's schema; a GET route declares none.
   * The route's body limit is the smaller of the configured limit and twice the largest encoding it admits plus 1,024 bytes.
   */
  readonly body?: Schema;
  /** The responses the route may write, by status. */
  readonly responses: ResponseSchemas;
}

/** A contract: route definitions by route name. */
export interface ContractRoutes {
  readonly [name: string]: RouteDefinition;
}

/** One reason a request or a response failed validation. */
export interface ErrorDetail {
  /** The JSON pointer of the failing value, starting with the part, as in `/body/name`. */
  readonly path: string;
  /** What is wrong; it never holds the received value. */
  readonly message: string;
}

/** The options of `new HttpError`. */
export interface HttpErrorOptions {
  /** The details written in the error body's `details`. */
  readonly details?: readonly ErrorDetail[];
  /** The underlying cause, kept on the error and never written to the client. */
  readonly cause?: unknown;
}

/** The one error body every Skeld server writes. */
export interface ErrorBody {
  /** The HTTP status, from 400 to 599. */
  readonly status: number;
  /** The machine-readable code, upper-case letters, digits and `_`. */
  readonly code: string;
  /**
   * A message for people.
   * Any thrown value other than an `HttpError` with a status is written as `Internal Server Error`.
   */
  readonly message: string;
  /** The validation details, when the error has them. */
  readonly details?: readonly ErrorDetail[];
}

/** The error codes the server and the client produce themselves. */
export type EngineErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'URI_TOO_LONG'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TIMEOUT'
  | 'INTERNAL'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE';

/** The type of a request part the route does not declare: an object with no keys. */
export interface Empty {
  readonly [key: string]: never;
}

/** A route's name, method and path, as errors and hook contexts report it. */
export interface RouteInfo {
  /** The route's name in its contract. */
  readonly name: string;
  /** The route's HTTP method. */
  readonly method: HttpMethod;
  /** The route's path pattern. */
  readonly path: string;
}

export type PathSegment =
  | { readonly kind: 'static'; readonly text: string }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'wildcard' };
