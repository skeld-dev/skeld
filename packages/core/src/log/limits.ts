// Does:  Holds every bound of the logger and the markers it writes in place of a value.
// Holds: Units are UTF-16 code units and bytes are UTF-8; no other module of the logger states one of these numbers.

export const RECORD_BYTES = 8_192;
export const QUEUE_BYTES = 1_048_576;
export const RESERVE_BYTES = 786_432;
export const BATCH_BYTES = 65_536;
export const TEXT_UNITS = 1_024;
export const NAME_UNITS = 64;
export const ENGINE_UNITS = 256;
export const FIELDS_MAX = 32;
export const NODES_MAX = 256;
export const ERRORS_MAX = 2;
export const FRAMES_MAX = 10;
export const FRAME_UNITS = 256;
export const IDENTIFIER_UNITS = 128;
export const CHAIN_MAX = 16;
export const WINDOW_MS = 10_000;
export const WINDOW_RECORDS = 20;
export const RETRY_MS = 10;
export const FLUSH_TIMEOUT_MS = 1_000;

export const SECRET_MARKER = '[secret]';
export const PERSONAL_MARKER = '[personal]';
export const INVALID_MARKER = '[invalid]';
export const UNCLASSIFIED_MARKER = '[unclassified]';
export const TRUNCATED_MARKER = '[truncated]';
export const UNREAD_MARKER = '[unread]';
export const OTHER = '_OTHER';
