// Does:  Declares auth's diagnostic hooks and gives each an empty implementation for the shipped build.
// Holds: Every hook here does nothing and returns at once; the shipped build never loads the recorder.

export type Token = number;
export type SpanName =
  | 'auth.gate.identify'
  | 'auth.gate.authorize'
  | 'auth.store.op'
  | 'auth.hash.compute'
  | 'auth.outbound.fetch';
export type CountName =
  | 'auth.hash.computed'
  | 'auth.store.busy_retry'
  | 'auth.store.deadline'
  | 'auth.store.cleanup_rows'
  | 'auth.session.renew'
  | 'auth.outbound.refused';
// Why: The hook list declares no auth event (a failed check is a keyed count), so the event hook accepts no name.
export type EventName = never;
export type LimitName =
  | 'auth.hash.waiting'
  | 'auth.store.waiting'
  | 'auth.outbound.in_flight'
  | 'auth.outbound.waiting';

export type Start = (name: SpanName, key?: string | number) => Token;
export type End = (token: Token) => void;
export type Count = (name: CountName, key: string) => void;
export type Event = (name: EventName, subject?: string | number) => void;
export type Limit = (name: LimitName, used: number, max: number) => void;

const none = (): void => undefined;
const zero = (): number => 0;

export const start: Start = zero;
export const end: End = none;
export const count: Count = none;
export const event: Event = none;
export const limit: Limit = none;
