// Does:  Declares every diagnostic hook and gives each an empty implementation for the shipped build.
// Holds: Every hook here does nothing and returns at once; the shipped build never loads the recorder.

import type { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http';
import type { RouteDefinition, RouteInfo } from '../contract/types.ts';
import type { ResolvedServerOptions } from '../server/types.ts';

export type Slot = number;
export type Token = number;
export type StageName =
  | 'req.preroute'
  | 'req.route.find'
  | 'req.hook.on_request'
  | 'req.body'
  | 'req.body.read'
  | 'req.body.parse'
  | 'req.validate'
  | 'req.hook.pre_handler'
  | 'req.handler'
  | 'req.respond'
  | 'req.hook.on_send'
  | 'req.respond.write';
export type StepName =
  | 'req.preroute.framing'
  | 'req.preroute.target'
  | 'req.route.split'
  | 'req.route.match'
  | 'req.body.media_type'
  | 'req.body.forbidden_key'
  | 'req.query.parse'
  | 'req.validate.part'
  | 'req.validate.errors'
  | 'req.handler.arg'
  | 'req.respond.serialize';
export type ErrorSpanName = 'err.path' | 'err.hook.on_error' | 'err.handler' | 'err.write' | 'err.stderr_write';
export type BootSpanName =
  | 'boot.options'
  | 'boot.contract_check'
  | 'boot.plugins'
  | 'boot.plugin'
  | 'boot.runtime'
  | 'boot.schema_checks'
  | 'boot.compile_validators'
  | 'boot.compile_serializers'
  | 'boot.body_cap'
  | 'boot.declare'
  | 'boot.error_serializer'
  | 'boot.router_add'
  | 'boot.listen';
export type SpanName = StageName | StepName | ErrorSpanName | BootSpanName;
export type TrackName =
  | 'refuse.teardown'
  | 'req.hook.on_response'
  | 'close.total'
  | 'client.call'
  | 'client.url'
  | 'client.headers'
  | 'client.fetch'
  | 'client.read'
  | 'client.validate';
export type CountName = 'refuse.not_found' | 'err.http_error';
export type EventName =
  | 'refuse.close'
  | 'refuse.framing'
  | 'refuse.path'
  | 'refuse.param_too_long'
  | 'refuse.media_type'
  | 'refuse.body_limit'
  | 'refuse.body_json'
  | 'refuse.body_depth'
  | 'refuse.forbidden_key'
  | 'refuse.validation'
  | 'refuse.body_aborted'
  | 'err.internal'
  | 'err.undeclared_status'
  | 'err.serialize'
  | 'err.already_sent'
  | 'err.headers_sent'
  | 'close.forced'
  | 'client.error';
export type LimitName =
  | 'limit.refusal_bytes'
  | 'limit.refusal_connections'
  | 'limit.body_bytes'
  | 'limit.param_length'
  | 'limit.validation_details'
  | 'limit.raw_errors';
export type ContextKind = 'handler' | 'request' | 'validated' | 'response' | 'error' | 'completed';
export type HeaderValue = number | string | readonly string[];

export type Begin = (req: IncomingMessage, res: ServerResponse) => Slot;
export type Leave = (slot: Slot) => void;
export type Resume = (slot: Slot) => void;
export type Current = () => Slot;
export type Routed = (route: RouteInfo) => void;
export type Start = (name: SpanName, key?: string | number) => Token;
export type End = (token: Token) => void;
export type Next = (token: Token, name: SpanName) => Token;
export type Track = (name: TrackName, key?: string) => Token;
export type Count = (name: CountName, key: string) => void;
export type Event = (name: EventName, subject?: string | number) => void;
export type Limit = (name: LimitName, used: number, max: number) => void;
export type Wrote = (status: number, headers: OutgoingHttpHeaders | null, payload: string | Uint8Array | null) => void;
export type Destroyed = () => void;
export type Header = (name: string, value: HeaderValue) => void;
export type Contain = (kind: ContextKind, value: object) => void;
export type Payload = (status: number, serialized: string) => void;
export type Key = (key: string) => void;
export type Stderr = (line: string) => void;
export type Open = (options: ResolvedServerOptions) => void;
export type Declare = (route: RouteInfo, definition: RouteDefinition) => void;
export type Listening = (server: Server) => void;
export type Closed = () => void;
export type Mark = () => void;

const none = (): void => undefined;
const zero = (): number => 0;

export const begin: Begin = zero;
export const leave: Leave = none;
export const resume: Resume = none;
export const current: Current = zero;
export const routed: Routed = none;
export const start: Start = zero;
export const end: End = none;
export const next: Next = zero;
export const track: Track = zero;
export const count: Count = none;
export const event: Event = none;
export const limit: Limit = none;
export const wrote: Wrote = none;
export const destroyed: Destroyed = none;
export const header: Header = none;
export const contain: Contain = none;
export const payload: Payload = none;
export const key: Key = none;
export const stderr: Stderr = none;
export const open: Open = none;
export const declare: Declare = none;
export const listening: Listening = none;
export const closed: Closed = none;
export const mark: Mark = none;
