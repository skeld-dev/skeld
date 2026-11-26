// Does:  Declares data's diagnostic hooks and gives each an empty implementation for the shipped build.
// Holds: Every hook here does nothing and returns at once; the shipped build never loads the recorder.

export type Token = number;
export type SpanName = 'data.pg.connect' | 'data.pool.acquire' | 'data.statement' | 'data.limit.charge';
export type CountName =
  | 'data.pg.protocol'
  | 'data.pg.mechanism'
  | 'data.pg.key_bytes'
  | 'data.pg.cancel'
  | 'data.connect.failed'
  | 'data.connection.closed'
  | 'data.statement.failed'
  | 'data.rows.refused'
  | 'data.limit.outcome'
  | 'data.limit.cache_hit'
  | 'data.limit.cleanup_rows';
export type LimitName = 'data.pool.open' | 'data.pool.waiting' | 'data.limit.cache';

export type Start = (name: SpanName, key?: string | number) => Token;
export type End = (token: Token) => void;
export type Count = (name: CountName, key: string) => void;
export type Limit = (name: LimitName, used: number, max: number) => void;

const none = (): void => undefined;
const zero = (): number => 0;

export const start: Start = zero;
export const end: End = none;
export const count: Count = none;
export const limit: Limit = none;
