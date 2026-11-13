// Does: Describes prepared, source-backed scenarios for the static walkthrough library.
// Holds: Content is illustrative data; adding a scenario cannot enable runtime execution.
export const groups = [
  'Requests',
  'Responses',
  'Logging',
  'Startup',
  'Errors',
  'Request lifetime',
  'Browser policies',
  'Typed client',
] as const;
export interface Stage {
  title: string;
  code: string;
  detail: string;
}
export interface Example {
  id: string;
  group: (typeof groups)[number];
  title: string;
  note: string;
  question: string;
  context: string;
  inputLabel: string;
  input: string;
  stages: readonly [Stage, Stage, Stage];
  stopAt: 2 | 3;
  tone: 'positive' | 'warning';
  outcome: string;
  reason: string;
  outputLabel: string;
  output: string;
  outputNote: string;
  code: string;
  why: string;
  limit: string;
  docs: string;
  compare: string;
}
const stage = (title: string, code: string, detail: string): Stage => ({ title, code, detail });
const validation = '{ "status": 400,\n  "code": "VALIDATION",\n  "message": "Request validation failed" }';
const internal = '{ "status": 500,\n  "code": "INTERNAL",\n  "message": "Internal Server Error" }';
const inputCode = 'body: t.object({\n  name: t.string({ maxLength: 24 })\n})';
const inputStages = (valid: boolean, detail: string): Example['stages'] => [
  stage('Request arrives', 'POST /projects', 'A JSON body enters the route.'),
  stage('Validate input', 'string · maxLength: 24', detail),
  stage(
    'Route handler',
    'createProject(name)',
    valid ? 'Called with the validated name.' : 'Not called. No project created.',
  ),
];
function inputExample(id: string, title: string, note: string, input: string, detail: string, valid = false): Example {
  return {
    id,
    group: 'Requests',
    title,
    note,
    question: 'Will this request reach your handler?',
    context: 'POST /projects',
    inputLabel: 'Incoming JSON',
    input,
    stages: inputStages(valid, detail),
    stopAt: valid ? 3 : 2,
    tone: valid ? 'positive' : 'warning',
    outcome: valid ? '201 · The handler runs.' : '400 · Rejected before the handler.',
    reason: detail,
    outputLabel: 'Response body',
    output: valid ? '{ "name": "polar" }' : validation,
    outputNote: valid ? '201 Created · application/json' : 'Error envelope excerpt; field details omitted.',
    code: inputCode,
    why: 'The body schema is checked before the normal route handler receives it. A required string must be present, have the right type and satisfy its declared bounds.',
    limit:
      'Validation checks data, not identity or permission. Early onRequest hooks run before body validation and must treat input as untrusted.',
    docs: '/docs/concepts/request-lifecycle/',
    compare: valid ? 'long' : 'valid',
  };
}
const responseStages = (passed: boolean, detail: string): Example['stages'] => [
  stage('Handler returns', 'return { status, body }', 'Your application constructs a response.'),
  stage('Serialize response', 'Declared response schema', detail),
  stage(
    'Success body',
    'application/json',
    passed ? 'The declared response reaches the client.' : 'Not sent. A fixed error replaces it.',
  ),
];
const loggingStages = (detail: string): Example['stages'] => [
  stage('Application value', 'Synthetic example data', 'The handler has a value to log.'),
  stage('Log field handling', 'Classified or ordinary field', detail),
  stage('Log destination', 'Structured record', 'Inspect the field excerpt below.'),
];
const startupStages = (detail: string): Example['stages'] => [
  stage('Declare a route', 'Contract + handler', 'The application supplies its schemas.'),
  stage('Inspect at startup', 'await server.listen(…)', detail),
  stage('Accept requests', 'Listening socket', 'Not reached. Startup is refused.'),
];
export const examples: readonly Example[] = [
  inputExample(
    'valid',
    'Within the limit',
    'A short string reaches the handler.',
    '{ "name": "polar" }',
    '“polar” is a string with 5 characters, within the 24-character limit.',
    true,
  ),
  inputExample(
    'long',
    'Too long',
    'An overlong string stops at validation.',
    '{ "name": "a-project-name-that-is-too-long" }',
    'The name has 31 characters. The contract permits at most 24.',
  ),
  inputExample(
    'type',
    'Wrong type',
    'A number cannot stand in for a string.',
    '{ "name": 42 }',
    'The name is a number. Skeld rejects it instead of coercing it into a string.',
  ),
  inputExample(
    'missing',
    'Missing required field',
    'Leaving out the name is not optional.',
    '{}',
    'The required name field is missing. An optional field would need an explicit optional schema.',
  ),
  {
    id: 'omit',
    group: 'Responses',
    title: 'Extra field returned',
    note: 'Only declared fields go onto the wire.',
    question: 'Does everything you return leave the service?',
    context: 'Response projection',
    inputLabel: 'Handler body',
    input: '{ "name": "polar",\n  "internalId": "prj_01" }',
    stages: responseStages(true, 'name is declared. internalId is omitted.'),
    stopAt: 3,
    tone: 'positive',
    outcome: '200 · The extra field is omitted.',
    reason:
      'The handler returned two fields. The response contract declares only name, so internalId is absent from the serialized body.',
    outputLabel: 'Response body',
    output: '{ "name": "polar" }',
    outputNote: '200 OK · application/json',
    code: `responses: {
  200: t.object({
    name: t.string({ maxLength: 24 })
  })
}`,
    why: 'Normal object responses are serialized through their declared schema. The handler can use richer internal objects without automatically sending every property.',
    limit:
      'This applies to declared normal responses. Early raw hook replies and author-written errors have different disclosure rules.',
    docs: '/docs/concepts/request-lifecycle/',
    compare: 'mismatch',
  },
  {
    id: 'mismatch',
    group: 'Responses',
    title: 'Response has the wrong type',
    note: 'A broken response contract becomes 500.',
    question: 'What if your handler breaks its promise?',
    context: 'Response validation',
    inputLabel: 'Handler body',
    input: '{ "name": 42 }',
    stages: responseStages(false, 'The declared name must be a string.'),
    stopAt: 2,
    tone: 'warning',
    outcome: '500 · The invalid body is not sent.',
    reason:
      'The handler already ran, but its result violates the response contract. Skeld sends the fixed internal error instead of that body.',
    outputLabel: 'Response body',
    output: internal,
    outputNote: 'Fixed error envelope; the invalid value is absent.',
    code: `responses: {
  200: t.object({
    name: t.string({ maxLength: 24 })
  })
}
// Handler returns: { name: 42 }`,
    why: 'Response checks defend the outgoing boundary even when a cast, JavaScript caller or application bug bypasses TypeScript.',
    limit: 'A serialization failure cannot undo side effects the handler already performed.',
    docs: '/docs/guides/client-and-errors/',
    compare: 'omit',
  },
  {
    id: 'expose',
    group: 'Responses',
    title: 'Explicit secret exposure',
    note: 'An explicit opt-in permits disclosure.',
    question: 'Can a secret intentionally leave the service?',
    context: 'Declared secret response',
    inputLabel: 'Handler body',
    input: '{ "token": "demo_token" }',
    stages: responseStages(true, 'This secret response field explicitly allows exposure.'),
    stopAt: 3,
    tone: 'warning',
    outcome: '200 · The secret value is sent.',
    reason:
      't.exposed(schema, reason) records an explicit disclosure decision. This response is allowed to contain the synthetic token.',
    outputLabel: 'Response body',
    output: '{ "token": "demo_token" }',
    outputNote: 'Synthetic token only. Explicit exposure permits the raw value.',
    code: `responses: {
  200: t.object({
    token: t.exposed(
      t.string({
        maxLength: 64, sensitivity: 'secret'
      }),
      'returned once at creation'
    )
  })
}`,
    why: 'A secret response field is refused unless its schema deliberately opts into exposure. The opt-in makes that decision visible in the contract.',
    limit: 'Exposure does not authorize the recipient. The application must decide who may receive this value.',
    docs: '/docs/guides/classification/',
    compare: 'secret-startup',
  },
  {
    id: 'secret-log',
    group: 'Logging',
    title: 'Secret in a classified log',
    note: 'The declared secret becomes [secret].',
    question: 'What reaches the log destination?',
    context: 'Schema-aware logging',
    inputLabel: 'Submitted body',
    input: '{ "token": "demo_token" }',
    stages: loggingStages('The schema marks token as secret.'),
    stopAt: 3,
    tone: 'positive',
    outcome: 'The log contains a marker, not the token.',
    reason:
      "Passing the body through request.classified('body') carries its schema classification into the log projection.",
    outputLabel: 'Log field excerpt',
    output: '{ "input": { "token": "[secret]" } }',
    outputNote: 'Metadata and unrelated log fields omitted.',
    code: `token: t.string({
  maxLength: 64, sensitivity: 'secret'
})

request.log.info('received', {
  input: request.classified('body')
});`,
    why: 'The classified log field is projected using its declared schema. Secret nodes are replaced with the secret marker.',
    limit: 'This does not scan arbitrary messages for secrets. Raw strings and exposed values need separate care.',
    docs: '/docs/logging/logging/',
    compare: 'raw-log',
  },
  {
    id: 'personal-log',
    group: 'Logging',
    title: 'Personal data in a classified log',
    note: 'The email becomes [personal].',
    question: 'Does personal classification change log output?',
    context: 'Schema-aware logging',
    inputLabel: 'Submitted body',
    input: '{ "email": "ada@example.test" }',
    stages: loggingStages('The schema marks email as personal.'),
    stopAt: 3,
    tone: 'positive',
    outcome: 'The email is masked in this log field.',
    reason:
      'The classified body carries the personal label to the logger, which writes [personal] in place of the email.',
    outputLabel: 'Log field excerpt',
    output: '{ "input": { "email": "[personal]" } }',
    outputNote: 'Metadata and unrelated log fields omitted.',
    code: `email: t.string({
  maxLength: 128, sensitivity: 'personal'
})

request.log.info('received', {
  input: request.classified('body')
});`,
    why: 'Personal values remain ordinary values for application code. Schema-aware logging supplies the classification needed to mask them.',
    limit:
      'Personal classification does not automatically hide a value in an HTTP response or a directly logged scalar.',
    docs: '/docs/guides/classification/',
    compare: 'raw-log',
  },
  {
    id: 'raw-log',
    group: 'Logging',
    title: 'Personal data logged directly',
    note: 'An ordinary scalar can disclose the value.',
    question: 'What if you leave the classification behind?',
    context: 'Ordinary log field',
    inputLabel: 'Application value',
    input: 'email = "ada@example.test"',
    stages: loggingStages('This call passes an ordinary string, without its schema.'),
    stopAt: 3,
    tone: 'warning',
    outcome: 'The email appears in the log.',
    reason:
      'The logger does not infer that an arbitrary string is personal data. The direct scalar field keeps its value.',
    outputLabel: 'Log field excerpt',
    output: '{ "email": "ada@example.test" }',
    outputNote: 'Synthetic email. This example intentionally shows disclosure.',
    code: `request.log.info('received', {
  email: request.body.email
});

// Compare with:
// input: request.classified('body')`,
    why: 'Classification is attached to a schema-aware log field, not to every future use of an ordinary string.',
    limit:
      'Secret wrappers have their own masking behavior. This example concerns an ordinary personal string, not a Secret object.',
    docs: '/docs/logging/logging/',
    compare: 'personal-log',
  },
  {
    id: 'secret-startup',
    group: 'Startup',
    title: 'Secret response without exposure',
    note: 'The route is refused before listening.',
    question: 'Can an unsafe declaration start serving?',
    context: 'Startup inspection',
    inputLabel: 'Response field declaration',
    input: "token: t.string({\n  maxLength: 64, sensitivity: 'secret'\n})",
    stages: startupStages('A secret response field lacks explicit exposure.'),
    stopAt: 2,
    tone: 'warning',
    outcome: 'Startup refused · SECRET_IN_RESPONSE',
    reason:
      'Skeld refuses the declaration when listen inspects the routes. No request is needed to discover this problem.',
    outputLabel: 'Startup error code',
    output: 'SECRET_IN_RESPONSE',
    outputNote: 'BootError excerpt. This is not an HTTP status.',
    code: `responses: {
  200: t.object({
    token: t.string({
      maxLength: 64, sensitivity: 'secret'
    })
  })
}`,
    why: 'A secret field in a response must explicitly declare exposure. The startup check makes accidental disclosure a configuration error.',
    limit:
      'Wrapping the field in t.exposed permits disclosure; it does not establish that disclosure is appropriate for a caller.',
    docs: '/docs/guides/classification/',
    compare: 'expose',
  },
  {
    id: 'unbounded',
    group: 'Startup',
    title: 'String without a bound',
    note: 'A missing maximum is a startup error.',
    question: 'What happens when you forget a bound?',
    context: 'Startup inspection',
    inputLabel: 'Request field declaration',
    input: 'name: t.string({})',
    stages: startupStages('The string has no maximum or documented unbounded reason.'),
    stopAt: 2,
    tone: 'warning',
    outcome: 'Startup refused · UNBOUNDED_FIELD',
    reason: 'The route cannot start with this string declaration. Supply maxLength or an explicit unbounded reason.',
    outputLabel: 'Startup error code',
    output: 'UNBOUNDED_FIELD',
    outputNote: 'BootError excerpt. No request handler is running.',
    code: `// Invalid in TypeScript; also refused at runtime:
name: t.string({})

// Bounded declaration:
name: t.string({ maxLength: 24 })`,
    why: 'TypeScript requires bounds or a documented escape hatch. If JavaScript or a cast bypasses that check, startup inspection still refuses the unbounded declaration.',
    limit:
      'A field bound is one control. Body limits, aggregate traffic and downstream resource use still need their own limits.',
    docs: '/docs/api/core/schema/',
    compare: 'long',
  },
  {
    id: 'throw',
    group: 'Errors',
    title: 'Unexpected exception',
    note: 'An internal message stays out of the response.',
    question: 'Does a thrown error reveal its message?',
    context: 'Default error path',
    inputLabel: 'Handler throws',
    input: 'throw new Error("database detail");',
    stages: [
      stage('Handler throws', 'Error', 'The application encounters an unexpected failure.'),
      stage('Default error path', 'Fixed internal error', 'The arbitrary message is not used as response content.'),
      stage('Client receives', '500 INTERNAL', 'The fixed envelope goes to the caller.'),
    ],
    stopAt: 3,
    tone: 'warning',
    outcome: '500 · A fixed error reaches the caller.',
    reason: 'The default response does not repeat the arbitrary exception message.',
    outputLabel: 'Response body',
    output: internal,
    outputNote: 'The string “database detail” is absent from this response.',
    code: `throw new Error('database detail');

// Default response code: INTERNAL`,
    why: 'An unexpected exception is not treated as an author-approved client message.',
    limit:
      'Logs and diagnostics are separate outputs. A custom error handler or deliberate HttpError can change what the caller receives.',
    docs: '/docs/guides/client-and-errors/',
    compare: 'http-error',
  },
  {
    id: 'http-error',
    group: 'Errors',
    title: 'Intentional HTTP error',
    note: 'Your code and message are response content.',
    question: 'When does an error message reach the caller?',
    context: 'Author-written error',
    inputLabel: 'Handler throws',
    input: 'new HttpError(409, "NAME_TAKEN",\n  "Choose another name")',
    stages: [
      stage('Handler throws', 'HttpError', 'The application chooses an HTTP error.'),
      stage('Error response', '409 · NAME_TAKEN', 'The author-written message is response content.'),
      stage('Client receives', 'Choose another name', 'The caller can read that message.'),
    ],
    stopAt: 3,
    tone: 'positive',
    outcome: '409 · The intended message is sent.',
    reason:
      'An HttpError deliberately supplies a status, code and caller-facing message. Write that message for the recipient.',
    outputLabel: 'Response body',
    output: '{ "status": 409,\n  "code": "NAME_TAKEN",\n  "message": "Choose another name" }',
    outputNote: 'An intentional application error.',
    code: `throw new HttpError(
  409, 'NAME_TAKEN',
  'Choose another name'
);`,
    why: 'Known application failures can communicate a useful, deliberate error without exposing an unexpected exception.',
    limit:
      'Do not put private values in this message. Response-schema classification does not automatically redact author-written HttpError text.',
    docs: '/docs/guides/client-and-errors/',
    compare: 'throw',
  },
  {
    id: 'deadline',
    group: 'Request lifetime',
    title: 'Async work exceeds its deadline',
    note: 'The response times out; late work needs care.',
    question: 'What does a request deadline actually stop?',
    context: 'Asynchronous handler wait',
    inputLabel: 'Configured behavior',
    input: 'handlerTimeoutMs: 20\nhandler awaits work lasting 100 ms',
    stages: [
      stage('Handler waits', 'Pending promise', 'The request is waiting on asynchronous work.'),
      stage('Deadline expires', 'Request signal aborts', 'Skeld finishes the request with a timeout.'),
      stage('Success result', 'Late return value', 'Not used. The late success result is discarded.'),
    ],
    stopAt: 2,
    tone: 'warning',
    outcome: '503 · The request times out.',
    reason:
      'The request signal aborts and the late result is discarded. Work that ignores cancellation can still continue.',
    outputLabel: 'Response body',
    output: '{ "status": 503,\n  "code": "TIMEOUT",\n  "message": "Request timed out" }',
    outputNote: 'Illustrated order only; animation is not a timing measurement.',
    code: `createServer({ handlerTimeoutMs: 20 });

// Handler:
await workThatTakes100ms();
return { status: 200, body: { ok: true } };`,
    why: 'The request deadline starts at the first body or application promise wait and persists across later waits. It bounds asynchronous request waiting.',
    limit:
      'It cannot preempt synchronous JavaScript or undo side effects. Timer delivery can be late if the event loop is blocked.',
    docs: '/docs/concepts/request-lifecycle/',
    compare: 'cancel',
  },
  {
    id: 'cancel',
    group: 'Request lifetime',
    title: 'The caller disconnects',
    note: 'Cooperative work can observe cancellation.',
    question: 'Does the handler know the caller has gone?',
    context: 'Client disconnect',
    inputLabel: 'Prepared event sequence',
    input: 'Handler awaits work.\nThe client closes its connection.',
    stages: [
      stage('Handler waits', 'request.signal', 'Work has already started.'),
      stage('Client disconnects', 'Signal aborts', 'Cooperative work observes cancellation.'),
      stage('Normal response', 'Closed connection', 'No response delivery can be assumed.'),
    ],
    stopAt: 2,
    tone: 'warning',
    outcome: 'Disconnected · No guaranteed response.',
    reason:
      'The request signal lets your work react to the lost caller. In this example, the work checks that signal and stops.',
    outputLabel: 'Application observation',
    output: 'request.signal.aborted === true',
    outputNote: 'This is a signal observation, not an HTTP response body.',
    code: `// Pass the request signal to cooperative work:
await doWork({ signal: request.signal });`,
    why: 'Cancellation is communicated through the request signal. Code and downstream libraries have to honor it to stop their own work.',
    limit: 'Disconnecting does not roll back a write or forcibly terminate arbitrary application code.',
    docs: '/docs/concepts/request-lifecycle/',
    compare: 'deadline',
  },
  {
    id: 'cors',
    group: 'Browser policies',
    title: 'Origin outside the CORS list',
    note: 'No read grant does not mean no handler.',
    question: 'Does CORS prevent a request from executing?',
    context: 'Actual GET request · CORS enabled',
    inputLabel: 'Request headers',
    input: 'Origin: https://other.example.test',
    stages: [
      stage('GET arrives', 'An unlisted origin', 'This is an actual request, not a preflight.'),
      stage('Route executes', 'Handler runs', 'CORS alone does not reject the GET.'),
      stage('Response headers', 'No CORS grant', 'The browser does not grant cross-origin script access.'),
    ],
    stopAt: 3,
    tone: 'warning',
    outcome: 'The handler runs; no CORS read grant is sent.',
    reason:
      'An unlisted origin receives no Access-Control-Allow-Origin header. That controls browser reading, not application authorization.',
    outputLabel: 'Response excerpt',
    output: 'HTTP 200\nAccess-Control-Allow-Origin: (absent)',
    outputNote: 'Header behavior is prepared. This page is not performing a cross-origin browser test.',
    code: `createServer({
  cors: {
    origins: ['https://app.example.test']
  }
});`,
    why: 'CORS governs whether browser code can read a cross-origin response. Preflight requests have a separate decision path.',
    limit:
      'CORS does not authenticate callers. POST, PUT, PATCH and DELETE also face the separate cross-site mutation policy.',
    docs: '/docs/guides/browser-security/',
    compare: 'csrf',
  },
  {
    id: 'csrf',
    group: 'Browser policies',
    title: 'Untrusted cross-site mutation',
    note: 'A foreign POST is refused before hooks.',
    question: 'Where is an untrusted cross-site write stopped?',
    context: 'POST /projects · baseline policy',
    inputLabel: 'Request headers',
    input: 'Origin: https://other.example.test\nSec-Fetch-Site: cross-site',
    stages: [
      stage('POST is routed', 'Mutation request', 'The target route exists.'),
      stage('Cross-site check', 'Origin is not trusted', 'The request is refused before onRequest.'),
      stage('Hooks and handler', 'Application code', 'Not reached for this refusal.'),
    ],
    stopAt: 2,
    tone: 'warning',
    outcome: '403 · The mutation is refused.',
    reason: 'A foreign origin with cross-site evidence does not pass the configured mutation policy.',
    outputLabel: 'Response code',
    output: '403 · CROSS_ORIGIN',
    outputNote: 'Prepared core policy decision under these exact headers.',
    code: `createServer({
  publicOrigin: 'https://api.example.test',
  csrf: { trustedOrigins: [] }
});`,
    why: 'The cross-site check runs after routing and before onRequest for mutation methods. Its trusted origins are separate from the CORS read list.',
    limit:
      'Non-browser callers can forge these headers. Passing this policy is not authentication, and GET/HEAD do not undergo this check.',
    docs: '/docs/guides/browser-security/',
    compare: 'cors',
  },
  {
    id: 'client-shape',
    group: 'Typed client',
    title: 'Server reply breaks the contract',
    note: 'The client rejects unexpected response data.',
    question: 'Can a typed client trust any successful response?',
    context: 'Declared 200 response',
    inputLabel: 'Remote response body',
    input: '{ "name": 42 }',
    stages: [
      stage('Read response', 'HTTP 200', 'A success status arrives from the remote service.'),
      stage('Validate declared body', 'name must be a string', 'The payload violates the client contract.'),
      stage('Typed success value', 'Client call resolves', 'Not reached. The client promise rejects.'),
    ],
    stopAt: 2,
    tone: 'warning',
    outcome: 'Client rejects · INVALID_RESPONSE',
    reason: 'A success status alone does not establish that the response matches the declared body schema.',
    outputLabel: 'Client error code',
    output: 'INVALID_RESPONSE',
    outputNote: 'HttpError with status: null; the remote server still sent HTTP 200.',
    code: `responses: {
  200: t.object({
    name: t.string({ maxLength: 24 })
  })
}

await client.readProject();`,
    why: 'The client validates declared JSON responses at runtime before returning their typed value.',
    limit:
      'An undeclared response status has an unknown body. Contract validation does not establish the remote service’s identity or business correctness.',
    docs: '/docs/guides/client-and-errors/',
    compare: 'client-size',
  },
  {
    id: 'client-size',
    group: 'Typed client',
    title: 'Remote response is too large',
    note: 'The client stops reading at its byte limit.',
    question: 'What if a remote response keeps growing?',
    context: 'Client response limit',
    inputLabel: 'Prepared response',
    input: 'maxResponseBytes: 128\nRemote body: 512 bytes',
    stages: [
      stage('Read response', 'Bounded body reader', 'Bytes arrive from a remote service.'),
      stage('Check byte limit', 'More than 128 bytes', 'The client refuses the oversized body.'),
      stage('Typed success value', 'Client call resolves', 'Not reached. The client promise rejects.'),
    ],
    stopAt: 2,
    tone: 'warning',
    outcome: 'Client rejects · RESPONSE_TOO_LARGE',
    reason: 'The configured response byte limit is exceeded. The client stops reading and rejects the call.',
    outputLabel: 'Client error code',
    output: 'RESPONSE_TOO_LARGE',
    outputNote: 'Client-side error, not a status sent by the remote service.',
    code: `const client = createClient(contract, {
  baseUrl: 'https://api.example.test',
  maxResponseBytes: 128
});`,
    why: 'The typed client bounds response bytes as well as validating declared JSON shapes. maxResponseBytes overrides the derived byte limit.',
    limit: 'A byte limit does not replace a request deadline or validate the business meaning of the response.',
    docs: '/docs/guides/client-and-errors/',
    compare: 'client-shape',
  },
];
