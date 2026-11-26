// Does:  Fixes the memory a result's row and value cost beyond the values' own bytes, for both engines' result bound.
// Holds: Both engines count a row as ROW_COST plus VALUE_COST per column plus its values' own bytes.

// Why: A row's value array and no-prototype row object hold about 290 bytes before any value (Node 26, 200,000 rows).
export const ROW_COST = 288;
// Why: Each value holds about 40 to 56 bytes of slots and headers beyond its own bytes (Node 26, 200,000 rows a shape).
export const VALUE_COST = 48;
