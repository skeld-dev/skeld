// Does:  Checks a server's policy tuple, adds auth.session, and binds each policy route to its policy and action.
// Holds: authorize admits only on a callback's true within one 5,000 ms deadline, and registers every grant it admits.

import { end, start } from '#diag';
import type { AuthorizeOutcome, GateFinding, GateInput, GateRequest, GateRoute } from '@skeld/core/gate';
import { boolean, type Schema } from '@skeld/core/schema';
import { AuthError } from '../auth-error/auth-error.ts';
import type { LimitRule } from '../limit/types.ts';
import type { AuthEvents } from '../server/internal-types.ts';
import { OptionFault } from '../server/option-fault.ts';
import { firstUnknownKey } from '../server/unknown-key.ts';
import { isAccessName } from './access-name.ts';
import { buildPolicy } from './define.ts';
import { grantRecord, isDefined, issueGrant } from './registry.ts';
import type { AnyPolicy, BoundPolicy, CredentialKind, Grant, PolicyBinder, Principal } from './types.ts';

// Why: The contract gives the four policy callbacks of one request a single deadline of 5,000 ms.
const DEADLINE_MS = 5000;
const MAX_TENANT_UNITS = 128;
const KINDS: ReadonlySet<unknown> = new Set(['session', 'api_key', 'jwt'] satisfies CredentialKind[]);
const PARTS = ['params', 'query', 'body'] as const;
const LATE = Symbol('late');

type Callback = (argument: unknown) => unknown;
type CallbackName = 'policy.load' | 'policy.tenant' | 'policy.action';

// Does:  A policy's options as checked at boot, each callback called on the object that declared it.
interface CheckedPolicy {
  readonly issuer: object;
  readonly name: string;
  readonly credentials: readonly CredentialKind[];
  readonly limit: LimitRule | null;
  readonly input: ReadonlyMap<string, unknown>;
  readonly load: Callback | null;
  readonly tenantOf: Callback | null;
  readonly member: Callback | null;
  readonly actions: ReadonlyMap<string, Callback>;
  readonly hidden: boolean;
}

const REFUSE_UNAVAILABLE: AuthorizeOutcome = Object.freeze({ kind: 'refuse', reason: 'unavailable' });
const REFUSE_MISSING: AuthorizeOutcome = Object.freeze({ kind: 'refuse', reason: 'resource_missing' });
const REFUSE_HIDDEN: AuthorizeOutcome = Object.freeze({ kind: 'refuse', reason: 'access_hidden' });
const REFUSE_DENIED: AuthorizeOutcome = Object.freeze({ kind: 'refuse', reason: 'access_denied' });

function fault(index: number, path: string, rule: string): OptionFault {
  return new OptionFault('policies', `policies[${index}]${path}: ${rule}`);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

// Why: Every schema node shares the prototype of the nodes the public builders make, and no other value has it.
const NODE_PROTOTYPE: unknown = Object.getPrototypeOf(boolean());

function isSchema(value: unknown): boolean {
  return isObject(value) && Object.getPrototypeOf(value) === NODE_PROTOTYPE;
}

const OPTION_KEYS: ReadonlySet<string> = new Set([
  'credentials',
  'limit',
  'input',
  'load',
  'tenant',
  'actions',
  'denial',
]);
const LIMIT_KEYS: ReadonlySet<string> = new Set(['max', 'windowSeconds']);
const TENANT_KEYS: ReadonlySet<string> = new Set(['of', 'member']);

// Does:  Refuses the first own key an option object does not declare, naming the key and never its value.
function refuseUnknown(target: object, known: ReadonlySet<string>, index: number, path: string, type: string): void {
  const unknown = firstUnknownKey(target, known);
  if (unknown !== null) {
    throw fault(index, `${path}.${unknown}`, `is not a key of ${type}`);
  }
}

function isLimitRule(value: unknown): value is LimitRule {
  if (!isObject(value)) {
    return false;
  }
  const max: unknown = Reflect.get(value, 'max');
  const windowSeconds: unknown = Reflect.get(value, 'windowSeconds');
  return (
    Number.isInteger(max) &&
    Number(max) >= 1 &&
    Number(max) <= 1_000_000 &&
    Number.isInteger(windowSeconds) &&
    Number(windowSeconds) >= 1 &&
    Number(windowSeconds) <= 86_400
  );
}

function method(target: object, key: string): Callback | null {
  const value: unknown = Reflect.get(target, key);
  return typeof value === 'function' ? (argument) => Reflect.apply(value, target, [argument]) : null;
}

function checkCredentials(value: unknown, index: number): readonly CredentialKind[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((kind) => KINDS.has(kind))) {
    throw fault(index, '.credentials', 'must list 1 or more of session, api_key and jwt');
  }
  return Object.freeze(value.filter((kind): kind is CredentialKind => KINDS.has(kind)));
}

function checkActions(value: unknown, index: number): ReadonlyMap<string, Callback> {
  const actions = new Map<string, Callback>();
  if (isObject(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (!isAccessName(key)) {
        throw fault(index, `.actions.${String(key)}`, 'must be an action name');
      }
      const rule = method(value, key);
      if (rule === null) {
        throw fault(index, `.actions.${key}`, 'must be a function');
      }
      actions.set(key, rule);
    }
  }
  if (actions.size === 0) {
    throw fault(index, '.actions', 'must map 1 or more action names to functions');
  }
  return actions;
}

// Does:  Reads a policy's tenant rule: absent, or of and member functions on a policy that has load.
function checkTenant(
  tenant: unknown,
  loads: boolean,
  index: number,
): { readonly tenantOf: Callback | null; readonly member: Callback | null } {
  if (tenant === undefined) {
    return { tenantOf: null, member: null };
  }
  if (!loads) {
    throw fault(index, '.tenant', 'needs load');
  }
  if (!isObject(tenant)) {
    throw fault(index, '.tenant', 'must have the functions of and member');
  }
  refuseUnknown(tenant, TENANT_KEYS, index, '.tenant', 'PolicyOptions.tenant');
  const tenantOf = method(tenant, 'of');
  const member = method(tenant, 'member');
  if (tenantOf === null || member === null) {
    throw fault(index, '.tenant', 'must have the functions of and member');
  }
  return { tenantOf, member };
}

// Does:  Reads one tuple entry's options once into a checked policy, or throws the option fault naming the rule.
function checkPolicy(policy: unknown, index: number): CheckedPolicy {
  if (!isDefined(policy) || !isObject(Reflect.get(policy, 'options'))) {
    throw fault(index, '', 'must be made by definePolicy');
  }
  const name: unknown = Reflect.get(policy, 'name');
  const options: object = Reflect.get(policy, 'options');
  if (typeof name !== 'string') {
    throw fault(index, '', 'must be made by definePolicy');
  }
  refuseUnknown(options, OPTION_KEYS, index, '', 'PolicyOptions');
  const limit: unknown = Reflect.get(options, 'limit');
  if (isObject(limit)) {
    refuseUnknown(limit, LIMIT_KEYS, index, '.limit', 'LimitRule');
  }
  if (limit !== undefined && !isLimitRule(limit)) {
    throw fault(index, '.limit', 'max must be an integer from 1 to 1,000,000 and windowSeconds from 1 to 86,400');
  }
  const input: unknown = Reflect.get(options, 'input');
  if (input !== undefined && !(isObject(input) && Object.values(input).every(isSchema))) {
    throw fault(index, '.input', 'must map keys to schemas');
  }
  const symbolInput = isObject(input) ? Object.getOwnPropertySymbols(input)[0] : undefined;
  if (symbolInput !== undefined) {
    throw fault(index, `.input.${String(symbolInput)}`, 'must be a string key');
  }
  const loadValue: unknown = Reflect.get(options, 'load');
  if (loadValue !== undefined && typeof loadValue !== 'function') {
    throw fault(index, '.load', 'must be a function');
  }
  const { tenantOf, member } = checkTenant(Reflect.get(options, 'tenant'), loadValue !== undefined, index);
  const denial: unknown = Reflect.get(options, 'denial');
  if (denial !== undefined && denial !== 'forbidden' && denial !== 'not_found') {
    throw fault(index, '.denial', "must be 'forbidden' or 'not_found'");
  }
  return Object.freeze({
    issuer: policy,
    name,
    credentials: checkCredentials(Reflect.get(options, 'credentials'), index),
    limit: limit === undefined ? null : Object.freeze({ max: limit.max, windowSeconds: limit.windowSeconds }),
    input: new Map(input === undefined ? [] : Object.entries(input)),
    load: method(options, 'load'),
    tenantOf,
    member,
    actions: checkActions(Reflect.get(options, 'actions'), index),
    hidden: denial === 'not_found',
  });
}

// Does:  Finds where each policy input lives in the route: the one part whose same key holds the same schema node.
// Holds: An input found in no part, or in more than one, binds nothing.
function inputSources(policy: CheckedPolicy, route: GateRoute): ReadonlyMap<string, (typeof PARTS)[number]> | null {
  const sources = new Map<string, (typeof PARTS)[number]>();
  for (const [key, schema] of policy.input) {
    const found = PARTS.filter((candidate) => {
      const declared: Schema | undefined = route.definition[candidate];
      return declared?.kind === 'object' && 'properties' in declared && isObject(declared.properties)
        ? Object.getOwnPropertyDescriptor(declared.properties, key)?.value === schema
        : false;
    });
    const [part] = found;
    if (found.length !== 1 || part === undefined) {
      return null;
    }
    sources.set(key, part);
  }
  return sources;
}

function inputValues(sources: ReadonlyMap<string, (typeof PARTS)[number]>, input: GateInput): object {
  const values: { [key: string]: unknown } = {};
  for (const [key, part] of sources) {
    const container: unknown = input[part];
    values[key] = isObject(container) ? Reflect.get(container, key) : undefined;
  }
  return Object.freeze(values);
}

// Does:  One authorize call's shared deadline: the signal its callbacks get and the step that races each against it.
interface Run {
  readonly principal: Principal;
  readonly signal: AbortSignal;
  step(callback: CallbackName, call: () => unknown): Promise<unknown>;
  malformed(callback: CallbackName): AuthError;
}

type Stage<T> = { readonly done: AuthorizeOutcome } | { readonly value: T };

// Does:  Starts one authorize call's 5,000 ms deadline; each step's throw, lateness or malformed answer is one record.
// Holds: A step answers LATE once the deadline passed, and every callback failure writes auth.callback.failed once.
function startRun(principal: Principal, request: GateRequest, events: AuthEvents): Run & { stop(): void } {
  const controller = new AbortController();
  const expiry = Promise.withResolvers<typeof LATE>();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The policy deadline passed', 'TimeoutError'));
    expiry.resolve(LATE);
  }, DEADLINE_MS);
  timer.unref();
  const failed = (callback: CallbackName, cause: 'threw' | 'deadline' | 'malformed'): void => {
    events.callbackFailed(request.log, { 'auth.callback': callback, 'auth.cause': cause });
  };
  return {
    principal,
    signal: AbortSignal.any([request.signal, controller.signal]),
    async step(callback, call) {
      try {
        const value = await Promise.race([Promise.try(call), expiry.promise]);
        if (value === LATE) {
          failed(callback, 'deadline');
        }
        return value;
      } catch (cause) {
        failed(callback, 'threw');
        throw new AuthError('CALLBACK_FAILED', { cause });
      }
    },
    malformed(callback) {
      failed(callback, 'malformed');
      return new AuthError('CALLBACK_FAILED');
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

async function loadStage(policy: CheckedPolicy, run: Run, input: object): Promise<Stage<unknown>> {
  const { load } = policy;
  if (load === null) {
    return { value: null };
  }
  const { principal, signal } = run;
  const resource = await run.step('policy.load', () => load({ principal, input, signal }));
  if (resource === LATE) {
    return { done: REFUSE_UNAVAILABLE };
  }
  // Why: undefined is what a lookup gives for a missing row, so it refuses as null does and never admits.
  return resource === null || resource === undefined ? { done: REFUSE_MISSING } : { value: resource };
}

// Does:  Names the resource's tenant and tests membership before any action; a non-member is hidden.
async function tenantStage(policy: CheckedPolicy, run: Run, resource: unknown): Promise<Stage<string | null>> {
  const { tenantOf, member } = policy;
  if (tenantOf === null || member === null) {
    return { value: null };
  }
  const tenant = await run.step('policy.tenant', () => tenantOf(resource));
  if (tenant === LATE) {
    return { done: REFUSE_UNAVAILABLE };
  }
  if (typeof tenant !== 'string' || tenant.length < 1 || tenant.length > MAX_TENANT_UNITS) {
    throw run.malformed('policy.tenant');
  }
  const { principal, signal } = run;
  const belongs = await run.step('policy.tenant', () => member({ principal, tenant, resource, signal }));
  if (belongs === LATE) {
    return { done: REFUSE_UNAVAILABLE };
  }
  if (typeof belongs !== 'boolean') {
    throw run.malformed('policy.tenant');
  }
  return belongs ? { value: tenant } : { done: REFUSE_HIDDEN };
}

// Does:  Binds one route's policy action: its checked policy, rule and input sources, with authorize and release.
function bindAction(
  policy: CheckedPolicy,
  action: string,
  rule: Callback,
  sources: ReadonlyMap<string, (typeof PARTS)[number]>,
  events: AuthEvents,
): BoundPolicy {
  async function decide(principal: Principal, input: GateInput, request: GateRequest): Promise<AuthorizeOutcome> {
    const run = startRun(principal, request, events);
    try {
      const loaded = await loadStage(policy, run, inputValues(sources, input));
      if ('done' in loaded) {
        return loaded.done;
      }
      const resource = loaded.value;
      const named = await tenantStage(policy, run, resource);
      if ('done' in named) {
        return named.done;
      }
      const tenant = named.value;
      const { signal } = run;
      const allowed = await run.step('policy.action', () => rule({ principal, resource, tenant, signal }));
      if (allowed === LATE) {
        return REFUSE_UNAVAILABLE;
      }
      if (typeof allowed !== 'boolean') {
        throw run.malformed('policy.action');
      }
      if (!allowed) {
        return policy.hidden ? REFUSE_HIDDEN : REFUSE_DENIED;
      }
      const grant: Grant<string, string, unknown> = Object.freeze({
        principal,
        policy: policy.name,
        action,
        tenant,
        resource,
        requestId: request.requestId,
      });
      issueGrant(grant, policy.issuer);
      return { kind: 'admit', grant };
    } finally {
      run.stop();
    }
  }

  return Object.freeze({
    policy: policy.name,
    action,
    credentials: policy.credentials,
    limit: policy.limit,
    async authorize(principal: Principal, input: GateInput, request: GateRequest): Promise<AuthorizeOutcome> {
      const span = start('auth.gate.authorize', policy.name);
      try {
        return await decide(principal, input, request);
      } finally {
        end(span);
      }
    },
    release(grant: unknown): void {
      const record = grantRecord(grant);
      if (record !== undefined && record.issuer === policy.issuer) {
        record.released = true;
      }
    },
  });
}

// Does:  Checks a server's policy tuple, adds the built-in auth.session and returns the binder of its policy routes.
// Holds: Every entry is a definePolicy policy with a unique name, or OptionFault policies names the first broken rule.
export function bindPolicies(policies: readonly AnyPolicy[], deps: { readonly events: AuthEvents }): PolicyBinder {
  const byName = new Map<string, CheckedPolicy>();
  const entries: unknown = policies;
  if (!Array.isArray(entries)) {
    throw new OptionFault('policies', 'policies: must be a list of policies');
  }
  entries.forEach((entry: unknown, index: number) => {
    const checked = checkPolicy(entry, index);
    if (checked.name.startsWith('auth.')) {
      throw fault(index, '.name', 'must not start with auth.');
    }
    if (byName.has(checked.name)) {
      throw fault(index, '.name', 'must be unique');
    }
    byName.set(checked.name, checked);
  });
  const session = buildPolicy('auth.session', { credentials: ['session'], actions: { use: () => true } });
  byName.set(session.name, checkPolicy(session, entries.length));
  const { events } = deps;
  return Object.freeze({
    bind(route: GateRoute): BoundPolicy | GateFinding {
      const { access } = route;
      const policy = typeof access === 'object' ? byName.get(access.policy) : undefined;
      if (typeof access !== 'object' || policy === undefined) {
        return { finding: 'unknown policy' };
      }
      const rule = policy.actions.get(access.action);
      if (rule === undefined) {
        return { finding: 'unknown action' };
      }
      const sources = inputSources(policy, route);
      if (sources === null) {
        return { finding: 'policy input not in the route schemas' };
      }
      return bindAction(policy, access.action, rule, sources, events);
    },
  });
}
