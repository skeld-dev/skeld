// Does:  Declares the generator's options, its result and the OpenAPI 3.1.2 subset the document is built from.
// Holds: Every document shape is plain JSON data; no field holds a function, a class instance or a core schema node.

import type { ContractRoutes } from '@skeld/core/contract';
import type { LiteralValue, Sensitivity } from '@skeld/core/schema';

/** The document's title, version and description. */
export interface OpenApiInfo {
  /** The API's title; it must not be blank. */
  readonly title: string;
  /** The API's version, as the application names it; it must not be blank. */
  readonly version: string;
  /** A description of the API. */
  readonly description?: string;
}

/** A server the API is served from. */
export interface OpenApiServer {
  /** An absolute `http` or `https` URL, or a path from the root; no credentials, fragment or `{` template. */
  readonly url: string;
  /** A description of the server. */
  readonly description?: string;
}

/**
 * One alternative of a route's security: each named scheme with the scopes it needs, all required together.
 * An empty object admits an anonymous caller; bearer and API-key schemes take no scopes.
 */
export interface SecurityRequirement {
  readonly [scheme: string]: readonly string[];
}

/**
 * A security scheme the document defines: an HTTP bearer token, an API key or an OpenID Connect provider.
 * Names match `[A-Za-z0-9._-]+`; an OpenID Connect URL is absolute `https` with no credentials or fragment.
 */
export type SecurityScheme =
  | {
      /** An HTTP authentication scheme. */
      readonly type: 'http';
      /** The bearer scheme, the only one supported. */
      readonly scheme: 'bearer';
      /** A hint of the token's format, such as `JWT`. */
      readonly bearerFormat?: string;
      /** A description of the scheme. */
      readonly description?: string;
    }
  | {
      /** A key sent in a header, a query parameter or a cookie. */
      readonly type: 'apiKey';
      /** Where the key is sent. */
      readonly in: 'header' | 'query' | 'cookie';
      /** The header, parameter or cookie name, valid for where it is sent. */
      readonly name: string;
      /** A description of the scheme. */
      readonly description?: string;
    }
  | {
      /** An OpenID Connect provider. */
      readonly type: 'openIdConnect';
      /** The provider's discovery URL, copied into the document and never fetched. */
      readonly openIdConnectUrl: string;
      /** A description of the scheme. */
      readonly description?: string;
    };

/** The documentation of one route: its summary, tags, operation ID, response descriptions and security. */
export interface RouteDocumentation {
  /** A one-line summary of the operation. */
  readonly summary?: string;
  /** A description of the operation. */
  readonly description?: string;
  /** The operation's tags, in the order given. */
  readonly tags?: readonly string[];
  /** The operation ID; the default is the route's name. IDs are nonempty and unique across the document. */
  readonly operationId?: string;
  /** Marks the operation deprecated. */
  readonly deprecated?: boolean;
  /** Descriptions of the route's declared statuses; a status the route does not declare is refused. */
  readonly responses?: { readonly [status: number]: string };
  /** The alternatives that admit a caller, any one of which suffices; it must agree with the route's access. */
  readonly security?: readonly SecurityRequirement[];
}

/**
 * The options of createOpenApi: the document's info, servers, per-route documentation and security schemes.
 * Every key of `routes` is a route of the contract; an unknown field or a value of the wrong type is refused.
 */
export interface OpenApiOptions<C extends ContractRoutes> {
  /** The document's title, version and description. */
  readonly info: OpenApiInfo;
  /** The servers the API is served from; omitted by default. */
  readonly servers?: readonly OpenApiServer[];
  /** The documentation of each route, by route name. */
  readonly routes?: { readonly [K in keyof C]?: RouteDocumentation };
  /** The security schemes the routes' requirements name, by scheme name. */
  readonly securitySchemes?: { readonly [name: string]: SecurityScheme };
}

/**
 * A JSON Schema 2020-12 node as the document emits it, with Skeld's `x-skeld-` extensions.
 * String length bounds count UTF-16 code units and appear only as extensions, never as `minLength` or `maxLength`.
 */
export interface OpenApiSchema {
  /** The JSON type the value has. */
  readonly type?: 'string' | 'integer' | 'number' | 'boolean' | 'null' | 'object' | 'array';
  /** The one value a literal accepts. */
  readonly const?: LiteralValue;
  /** The smallest number accepted. */
  readonly minimum?: number;
  /** The largest number accepted. */
  readonly maximum?: number;
  /** The fewest UTF-16 code units a string holds. */
  readonly 'x-skeld-minLengthUtf16'?: number;
  /** The most UTF-16 code units a string holds. */
  readonly 'x-skeld-maxLengthUtf16'?: number;
  /** An object's declared properties, by name. */
  readonly properties?: { readonly [name: string]: OpenApiSchema };
  /** The properties an object must have. */
  readonly required?: readonly string[];
  /** Whether an object may hold undeclared properties, or the schema of a record's values. */
  readonly additionalProperties?: boolean | OpenApiSchema;
  /** The fewest properties an object holds. */
  readonly minProperties?: number;
  /** The fewest declared properties an open request object holds; undeclared ones do not count. */
  readonly 'x-skeld-minDeclaredProperties'?: number;
  /** The most properties a record holds. */
  readonly maxProperties?: number;
  /** The schema of a record's keys. */
  readonly propertyNames?: OpenApiSchema;
  /** The schema of an array's items. */
  readonly items?: OpenApiSchema;
  /** The fewest items an array holds. */
  readonly minItems?: number;
  /** The most items an array holds. */
  readonly maxItems?: number;
  /** The members of a union, in declaration order; a value matches at least one. */
  readonly anyOf?: readonly OpenApiSchema[];
  /** Marks a secret request value that a response never returns. */
  readonly writeOnly?: true;
  /** The sensitivity class the contract declares for the value. */
  readonly 'x-sensitivity'?: Sensitivity;
}

/** A media type's content: the schema of its value. */
export interface OpenApiMediaType {
  /** The schema of the value. */
  readonly schema: OpenApiSchema;
}

/**
 * A request parameter: a path, query or header value described by a schema, or a raw cookie described as text.
 * A cookie's logical value schema is in `x-skeld-valueSchema`; core's strict text grammar decides what parses.
 */
export type OpenApiParameter =
  | {
      /** The parameter's name. */
      readonly name: string;
      /** Where the parameter is sent. */
      readonly in: 'path' | 'query' | 'header';
      /** Whether the parameter must be sent; a path parameter always is. */
      readonly required: boolean;
      /** How the value is serialized: `simple` for a path or header, `form` for a query. */
      readonly style: 'simple' | 'form';
      /** Whether an array is sent as repeated values; true for a query parameter. */
      readonly explode?: boolean;
      /** The schema of the parameter's logical value. */
      readonly schema: OpenApiSchema;
    }
  | {
      /** The cookie's name. */
      readonly name: string;
      /** Where the parameter is sent. */
      readonly in: 'cookie';
      /** Whether the cookie must be sent. */
      readonly required: boolean;
      /** The cookie's raw value, as text. */
      readonly content: { readonly 'text/plain': OpenApiMediaType };
      /** The schema of the cookie's logical scalar value. */
      readonly 'x-skeld-valueSchema': OpenApiSchema;
    };

/** A request body: JSON, and plain text when the body accepts a string. */
export interface OpenApiRequestBody {
  /** Whether a body must be sent: always true, as core refuses a request without one, even for an outer optional. */
  readonly required: boolean;
  /** The body's media types. */
  readonly content: {
    /** The JSON body. */
    readonly 'application/json': OpenApiMediaType;
    /** The plain-text body, present only when the body accepts a string. */
    readonly 'text/plain'?: OpenApiMediaType;
  };
}

/** One declared response: its description and, unless it has no body, its JSON content. */
export interface OpenApiResponse {
  /** The supplied description, or `Response <status>`. */
  readonly description: string;
  /** The JSON body; absent for a response without a body. */
  readonly content?: { readonly 'application/json': OpenApiMediaType };
}

/** A collective constraint on a parameter object that independent OpenAPI parameters cannot express. */
export interface OpenApiParameterConstraint {
  /** The fewest of the listed properties a request sends. */
  readonly minDeclaredProperties: number;
  /** The parameter object's declared properties. */
  readonly properties: readonly string[];
}

/** One operation: one route's method on its path. */
export interface OpenApiOperation {
  /** The operation ID: the supplied one or the route's name. */
  readonly operationId: string;
  /** A one-line summary of the operation. */
  readonly summary?: string;
  /** A description of the operation. */
  readonly description?: string;
  /** The operation's tags, in the order given. */
  readonly tags?: readonly string[];
  /** Marks the operation deprecated. */
  readonly deprecated?: boolean;
  /** The route's path, query, header and cookie parameters. */
  readonly parameters?: readonly OpenApiParameter[];
  /** The request body, when the route declares one. */
  readonly requestBody?: OpenApiRequestBody;
  /** The declared responses, by status. */
  readonly responses: { readonly [status: string]: OpenApiResponse };
  /** The alternatives that admit a caller; empty for a public route. */
  readonly security: readonly SecurityRequirement[];
  /** Minimum counts of declared properties on the route's parameter objects, by request part. */
  readonly 'x-skeld-parameterConstraints'?: {
    /** The path parameters' constraint. */
    readonly params?: OpenApiParameterConstraint;
    /** The query's constraint. */
    readonly query?: OpenApiParameterConstraint;
    /** The headers' constraint. */
    readonly headers?: OpenApiParameterConstraint;
    /** The cookies' constraint. */
    readonly cookies?: OpenApiParameterConstraint;
  };
}

/** The operations of one path, by lower-case method; only declared methods appear. */
export interface OpenApiPathItem {
  /** The GET operation. */
  readonly get?: OpenApiOperation;
  /** The PUT operation. */
  readonly put?: OpenApiOperation;
  /** The POST operation. */
  readonly post?: OpenApiOperation;
  /** The DELETE operation. */
  readonly delete?: OpenApiOperation;
  /** The PATCH operation. */
  readonly patch?: OpenApiOperation;
}

/** An OpenAPI 3.1.2 document: the subset createOpenApi emits, with schemas inline. */
export interface OpenApiDocument {
  /** The OpenAPI version. */
  readonly openapi: '3.1.2';
  /** The dialect of every schema in the document. */
  readonly jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema';
  /** The document's title, version and description. */
  readonly info: OpenApiInfo;
  /** The servers the API is served from. */
  readonly servers?: readonly OpenApiServer[];
  /** The operations, by path template. */
  readonly paths: { readonly [path: string]: OpenApiPathItem };
  /** The security schemes the operations name. */
  readonly components?: { readonly securitySchemes: { readonly [name: string]: SecurityScheme } };
}

/** What a diagnostic reports: a constraint the document describes more weakly than core enforces it. */
export type DiagnosticCode =
  | 'UTF16_LENGTH'
  | 'DECLARED_PROPERTY_COUNT'
  | 'TEXT_PARAMETER'
  | 'PARAMETER_OBJECT_CONSTRAINT'
  | 'RESERVED_HEADER';

/** One located diagnostic; the message is fixed by the code. */
export interface OpenApiDiagnostic {
  /** What the diagnostic reports. */
  readonly code: DiagnosticCode;
  /** The route, request or response part and property keys the diagnostic is about. */
  readonly location: readonly (string | number)[];
  /** The fixed message of the code. */
  readonly message: string;
}

/** A generated document and its diagnostics, sorted by location then code; fresh data no later call shares. */
export interface OpenApiResult {
  /** The OpenAPI document. */
  readonly document: OpenApiDocument;
  /** What the document describes more weakly than core enforces, with each case's location. */
  readonly diagnostics: readonly OpenApiDiagnostic[];
}
