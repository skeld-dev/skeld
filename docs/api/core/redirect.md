# @skeld/core/redirect

## RedirectRefusal

Why `checkRedirect` refused a target; the target itself is never part of it.

```ts
export type RedirectRefusal =
  | 'not a string'
  | 'surrounding whitespace'
  | 'control character'
  | 'backslash'
  | 'not a local path'
  | 'not a URL'
  | 'scheme not http or https'
  | 'userinfo'
  | 'origin not allowed';
```

Source: `packages/core/src/redirect/redirect.ts:5`

## RedirectCheck

The verdict of `checkRedirect`: the target to send, or the reason it was refused.

```ts
export type RedirectCheck =
  | {
      readonly kind: 'ok';
      readonly location: string;
    }
  | {
      readonly kind: 'refused';
      readonly reason: RedirectRefusal;
    };
```

| Field      | Summary                                                     |
| ---------- | ----------------------------------------------------------- |
| `kind`     | The target may be sent.                                     |
| `location` | The target to send, as the WHATWG URL parser serialises it. |
| `reason`   | Why it was refused.                                         |

Source: `packages/core/src/redirect/redirect.ts:17`

## checkRedirect

Checks a redirect target: a path on this service, or an absolute http(s) URL whose exact origin is listed.

Refuses whitespace around it, control characters, backslashes and userinfo; `redirectOrigins` defaults to none.

```ts
export function checkRedirect(location: unknown, redirectOrigins: readonly string[] = []): RedirectCheck;
```

```ts
checkRedirect('/login?next=%2Fhome', ['https://id.example.com']);
```

Source: `packages/core/src/redirect/redirect.ts:87`
