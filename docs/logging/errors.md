# Errors in records

One reader writes every error: a value the engine caught, and an error an author passes as a log field. It runs only for a record that passed its threshold and, for an engine record, suppression ([events.md](events.md#suppression)).

With no option, the reader writes a recognised class name and a recognised code, nothing else. Three options, all off by default, each add one part of the error:

| Option             | Adds                                        | Cost                                                       |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------- |
| `errorIdentifiers` | an unlisted class name and an unlisted code | unclassified text in the same keys as the lists            |
| `errorText`        | the error's message and its cause's message | unclassified text: nothing classifies what a message holds |
| `errorFrames`      | up to 10 stack frames                       | runs the process's stack formatter during the log call     |

Each option applies alike to engine-caught errors and to error fields.

## What is written

| Part                   | Engine record key                            | Key inside a field | Needs              | Written                                                                                                                                                        |
| ---------------------- | -------------------------------------------- | ------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kind                   | `skeld.exception.kind`                       | none               |                    | `error`; `non_error` when `Error.isError` is false; `unreadable` when reading the value failed                                                                 |
| type                   | `exception.type`                             | `type`             |                    | the nearest listed class of the value's prototype chain; `_OTHER` when none is found within 16 objects, a Proxy is met, or the chain ends                      |
| code                   | `skeld.exception.code`                       | `code`             |                    | the value's own `code` data property, only when it is a string in the code set                                                                                 |
| unlisted type and code | the same keys                                | the same keys      | `errorIdentifiers` | the `name` of the class's constructor and the own `code` string, 1 to 128 units, escaped, never cut; the class name is written even when an ancestor is listed |
| message, cause         | `exception.message`, `skeld.exception.cause` | `message`, `cause` | `errorText`        | the own `message` string; the own `message` of an own `cause` that is an error, one level deep; each cut at 1,024 units                                        |
| frames                 | `exception.stacktrace`                       | `stacktrace`       | `errorFrames`      | one string of frames joined by `\n`, by the extraction policy below; absent when there are no frames                                                           |

When the kind is `non_error`, nothing else is read: an engine record writes the kind alone, and a field follows the rule for its value ([record-format.md](record-format.md#field-values)), so a plain object passed as a field is `[unclassified]`. When the kind is `unreadable`, an engine record writes the kind alone and a field is written `[invalid]`.

A record reads at most 2 errors: the value the engine caught, or the first 2 error fields of an author's call in key order. A later error field is written `[unread]`.

## Engine faults

On `skeld.request.error` the reader runs only for `thrown` and `http_error`. A failure skeld makes itself (`undeclared_status`, `response_mismatch`, `reserved_header`, `invalid_cookie`, `redirect_refused`, `send_status`) writes no exception keys; its record carries `skeld.reason` and at most one detail key, whose value is bounded and never comes from the error's message, since skeld's message can hold application text. Three of the four keys hold only values skeld owns; `skeld.schema_location` holds property names from the contract's declaration, never a value. The keys and their value sets are in [record-format.md](record-format.md#keys).

## The two lists

Taken from the platform once, when the module loads. The values below were measured on Linux with Node 26.13.0.

**Listed classes (11).** `Error`, `EvalError`, `RangeError`, `ReferenceError`, `SyntaxError`, `TypeError`, `URIError`, `AggregateError`, `DOMException`, `HttpError`, `BootError`. Each is compared by identity with the prototypes of the value's chain, so a subclass reads as its nearest listed ancestor, and an error from another realm is `_OTHER`.

**Code set.** The keys of `os.constants.errno`, the names in `util.getSystemErrorMap()` and the 24 error-code constants of `node:dns`. The set follows the platform: it held 123 codes on Linux with Node 26.13.0, a measured count, not a portable constant.

```text
E2BIG EACCES EADDRGETNETWORKPARAMS EADDRINUSE EADDRNOTAVAIL EAFNOSUPPORT EAGAIN EAI_ADDRFAMILY
EAI_AGAIN EAI_BADFLAGS EAI_BADHINTS EAI_CANCELED EAI_FAIL EAI_FAMILY EAI_MEMORY EAI_NODATA
EAI_NONAME EAI_OVERFLOW EAI_PROTOCOL EAI_SERVICE EAI_SOCKTYPE EALREADY EBADF EBADFAMILY
EBADFLAGS EBADHINTS EBADMSG EBADNAME EBADQUERY EBADRESP EBADSTR EBUSY ECANCELED ECANCELLED
ECHARSET ECHILD ECONNABORTED ECONNREFUSED ECONNRESET EDEADLK EDESTADDRREQ EDESTRUCTION EDOM
EDQUOT EEXIST EFAULT EFBIG EFILE EFORMERR EFTYPE EHOSTDOWN EHOSTUNREACH EIDRM EILSEQ
EINPROGRESS EINTR EINVAL EIO EISCONN EISDIR ELOADIPHLPAPI ELOOP EMFILE EMLINK EMSGSIZE
EMULTIHOP ENAMETOOLONG ENETDOWN ENETRESET ENETUNREACH ENFILE ENOBUFS ENODATA ENODEV ENOENT
ENOEXEC ENOLCK ENOLINK ENOMEM ENOMSG ENONAME ENONET ENOPROTOOPT ENOSPC ENOSR ENOSTR ENOSYS
ENOTCONN ENOTDIR ENOTEMPTY ENOTFOUND ENOTIMP ENOTINITIALIZED ENOTSOCK ENOTSUP ENOTTY ENXIO
EOF EOPNOTSUPP EOVERFLOW EPERM EPIPE EPROTO EPROTONOSUPPORT EPROTOTYPE ERANGE EREFUSED
EREMOTEIO EROFS ESERVFAIL ESHUTDOWN ESOCKTNOSUPPORT ESPIPE ESRCH ESTALE ETIME ETIMEDOUT
ETIMEOUT ETXTBSY EUNATCH EWOULDBLOCK EXDEV UNKNOWN
```

## What a listed word tells you

- With no option, every type or code written is a word of a list, and the `stack` is neither read nor formatted: no stack-derived text reaches a default record.
- A listed word says what the prototype or the string is, never who set it. `Object.setPrototypeOf(err, RangeError.prototype)` reads as `RangeError`, and an assigned `code` of `ENOENT` reads as `ENOENT`.
- Your own error classes read as their nearest listed ancestor, usually `Error`, until you turn on `errorIdentifiers`.
- With an option on, its keys hold unclassified text. `errorIdentifiers` writes unclassified text into the same keys as the lists, so with it on, `exception.type` and `skeld.exception.code` no longer prove a listed word.
- Reading the kind, type, code, message and cause calls no function of the value and formats no stack.

## Stack frames

### Extraction policy

With `errorFrames` on, frames are taken in these steps. A step that fails gives the record without frames and ends the policy.

1. The value's own `stack` is the accessor V8 gives every error of this realm. A replaced accessor, a data property, no own `stack`, or another realm's error is left uncalled.
2. The value and its prototypes, at most 16 objects, each checked for being a Proxy before it is read: the chain ends within 16 objects with no Proxy, and the first own `name` and the first own `message` found are string data properties.
3. That accessor is called once on the value, inside its own catch, and returns a string.
4. The text begins with the header V8 builds from that name and message (`name: message`; the name alone when the message is empty; the message alone when the name is), then a newline. Each following line of the form `    at …` is a frame, up to the first line that is not one, and at most 10. A frame is cut at 256 units and loses the working directory at `listen`, with or without `file://`.

Steps 1 and 2 call no function of the value. Step 3 runs the process's stack formatter, `Error.prepareStackTrace` included. Step 4 checks syntax only: text assigned to `stack` that begins with the header passes.

A log call made by the formatter, or by anything it calls, writes its errors without frames, so frame extraction cannot recurse. With `errorFrames` off, no step runs: no stack read and no formatter call.

### What enabling `errorFrames` means

Enabling errorFrames permits application stack-formatting code to execute synchronously during logging. skeld catches formatter exceptions and omits frames for non-string results, but cannot bound execution time or undo side effects. Frame limits bound the output, not the work required to obtain it.

`errorFrames` is an explicit exception to logging's request-isolation guarantee. Suppression and the limit of 2 errors per record bound how often the formatter runs, never its time or its allocation.

Frames can contain application-supplied text, file paths and function names. Frame syntax is not redaction: a frame that passes step 4 can still carry anything the application put in it.
