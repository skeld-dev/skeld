# @skeld/auth/routes

## sessionStateSchema

The body of `authSession`: no session, or the live session with its CSRF token.

```ts
export const sessionStateSchema: import("@skeld/core/schema").UnionSchema<readonly [
    import("@skeld/core/schema").ObjectSchema<{
        status: import("@skeld/core/schema").LiteralSchema<"none">;
    }, undefined>,
    import("@skeld/core/schema").ObjectSchema<{
        status: import("@skeld/core/schema").LiteralSchema<"session">;
        userId: import("@skeld/core/schema").StringSchema<string>;
        csrfToken: import("@skeld/core/schema").ExposedSchema<string>;
        expiresAt: import("@skeld/core/schema").IntegerSchema<number>;
    }, undefined>
], import("@skeld/core/schema").ObjectStatic<{
    status: import("@skeld/core/schema").LiteralSchema<"none">;
}> | import("@skeld/core/schema").ObjectStatic<{
    status: import("@skeld/core/schema").LiteralSchema<"session">;
    userId: import("@skeld/core/schema").StringSchema<string>;
    csrfToken: import("@skeld/core/schema").ExposedSchema<string>;
    expiresAt: import("@skeld/core/schema").IntegerSchema<number>;
}>>
```

Source: `packages/auth/src/routes/routes.ts:10`

## sessionRoutes

The session routes whose handlers `auth.handlers.session` supplies: status, sign-out and dead-cookie cleanup.

```ts
export const sessionRoutes: {
    readonly authSession: {
        readonly method: "GET";
        readonly path: "/auth/session";
        readonly access: "optional";
        readonly responses: {
            200: import("@skeld/core/schema").UnionSchema<readonly [
                import("@skeld/core/schema").ObjectSchema<{
                    status: import("@skeld/core/schema").LiteralSchema<"none">;
                }, undefined>,
                import("@skeld/core/schema").ObjectSchema<{
                    status: import("@skeld/core/schema").LiteralSchema<"session">;
                    userId: import("@skeld/core/schema").StringSchema<string>;
                    csrfToken: import("@skeld/core/schema").ExposedSchema<string>;
                    expiresAt: import("@skeld/core/schema").IntegerSchema<number>;
                }, undefined>
            ], import("@skeld/core/schema").ObjectStatic<{
                status: import("@skeld/core/schema").LiteralSchema<"none">;
            }> | import("@skeld/core/schema").ObjectStatic<{
                status: import("@skeld/core/schema").LiteralSchema<"session">;
                userId: import("@skeld/core/schema").StringSchema<string>;
                csrfToken: import("@skeld/core/schema").ExposedSchema<string>;
                expiresAt: import("@skeld/core/schema").IntegerSchema<number>;
            }>>;
        };
    };
    readonly authSignOut: {
        readonly method: "POST";
        readonly path: "/auth/sign-out";
        readonly access: {
            readonly policy: "auth.session";
            readonly action: "use";
        };
        readonly responses: {
            204: null;
        };
    };
    readonly authSessionClear: {
        readonly method: "POST";
        readonly path: "/auth/session/clear";
        readonly access: "public";
        readonly responses: {
            204: null;
            429: import("@skeld/core/schema").ObjectSchema<{
                status: import("@skeld/core/schema").IntegerSchema<number>;
                code: import("@skeld/core/schema").StringSchema<string>;
                message: import("@skeld/core/schema").StringSchema<string>;
                details: import("@skeld/core/schema").OptionalSchema<import("@skeld/core/schema").ArraySchema<import("@skeld/core/schema").ObjectSchema<{
                    path: import("@skeld/core/schema").StringSchema<string>;
                    message: import("@skeld/core/schema").StringSchema<string>;
                }, undefined>, import("@skeld/core/schema").ObjectStatic<{
                    path: import("@skeld/core/schema").StringSchema<string>;
                    message: import("@skeld/core/schema").StringSchema<string>;
                }>[]>>;
            }, undefined>;
        };
    };
}
```

See `examples/auth/app.ts`.

Source: `packages/auth/src/routes/routes.ts:27`

## oidcRoutes

The OIDC routes whose handlers `oidc().handlers` supplies: one start and one callback route per provider name.

```ts
export const oidcRoutes: {
    readonly authOidcStart: {
        readonly method: "POST";
        readonly path: "/auth/oidc/:provider/start";
        readonly access: "public";
        readonly params: import("@skeld/core/schema").ObjectSchema<{
            provider: import("@skeld/core/schema").StringSchema<string>;
        }, undefined>;
        readonly body: import("@skeld/core/schema").ObjectSchema<{
            returnTo: import("@skeld/core/schema").OptionalSchema<import("@skeld/core/schema").StringSchema<string>>;
        }, undefined>;
        readonly responses: {
            200: import("@skeld/core/schema").ObjectSchema<{
                url: import("@skeld/core/schema").StringSchema<string>;
            }, undefined>;
            429: import("@skeld/core/schema").ObjectSchema<{
                status: import("@skeld/core/schema").IntegerSchema<number>;
                code: import("@skeld/core/schema").StringSchema<string>;
                message: import("@skeld/core/schema").StringSchema<string>;
                details: import("@skeld/core/schema").OptionalSchema<import("@skeld/core/schema").ArraySchema<import("@skeld/core/schema").ObjectSchema<{
                    path: import("@skeld/core/schema").StringSchema<string>;
                    message: import("@skeld/core/schema").StringSchema<string>;
                }, undefined>, import("@skeld/core/schema").ObjectStatic<{
                    path: import("@skeld/core/schema").StringSchema<string>;
                    message: import("@skeld/core/schema").StringSchema<string>;
                }>[]>>;
            }, undefined>;
        };
    };
    readonly authOidcCallback: {
        readonly method: "GET";
        readonly path: "/auth/oidc/:provider/callback";
        readonly access: "public";
        readonly params: import("@skeld/core/schema").ObjectSchema<{
            provider: import("@skeld/core/schema").StringSchema<string>;
        }, undefined>;
        readonly query: import("@skeld/core/schema").ObjectSchema<{
            state: import("@skeld/core/schema").StringSchema<string>;
            code: import("@skeld/core/schema").OptionalSchema<import("@skeld/core/schema").StringSchema<import("@skeld/core/secret").Secret<string>>>;
            iss: import("@skeld/core/schema").OptionalSchema<import("@skeld/core/schema").StringSchema<string>>;
            error: import("@skeld/core/schema").OptionalSchema<import("@skeld/core/schema").StringSchema<string>>;
        }, undefined>;
        readonly responses: {
            303: null;
            429: import("@skeld/core/schema").ObjectSchema<{
                status: import("@skeld/core/schema").IntegerSchema<number>;
                code: import("@skeld/core/schema").StringSchema<string>;
                message: import("@skeld/core/schema").StringSchema<string>;
                details: import("@skeld/core/schema").OptionalSchema<import("@skeld/core/schema").ArraySchema<import("@skeld/core/schema").ObjectSchema<{
                    path: import("@skeld/core/schema").StringSchema<string>;
                    message: import("@skeld/core/schema").StringSchema<string>;
                }, undefined>, import("@skeld/core/schema").ObjectStatic<{
                    path: import("@skeld/core/schema").StringSchema<string>;
                    message: import("@skeld/core/schema").StringSchema<string>;
                }>[]>>;
            }, undefined>;
        };
    };
}
```

See `examples/auth/app.ts`.

Source: `packages/auth/src/routes/routes.ts:52`

## SessionRoutes

The type of `sessionRoutes`.

```ts
export type SessionRoutes = typeof sessionRoutes;
```

Source: `packages/auth/src/routes/routes.ts:77`

## OidcRoutes

The type of `oidcRoutes`.

```ts
export type OidcRoutes = typeof oidcRoutes;
```

Source: `packages/auth/src/routes/routes.ts:80`
