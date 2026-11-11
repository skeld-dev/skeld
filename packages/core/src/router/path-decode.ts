// Does:  Splits a raw path into percent-decoded segments, keeping each segment's raw length.
// Holds: Each segment is decoded exactly once; a malformed escape yields null, never a partial path.

export interface PathPart {
  readonly text: string;
  readonly rawLength: number;
}

function decodeSegment(raw: string): string | null {
  if (!raw.includes('%')) {
    return raw;
  }
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

export function splitPath(rawPath: string): readonly PathPart[] | null {
  const parts: PathPart[] = [];
  // Why: Split before decoding, so an encoded slash (%2F) stays inside its segment.
  for (const raw of rawPath.slice(1).split('/')) {
    const text = decodeSegment(raw);
    if (text === null) {
      return null;
    }
    parts.push({ text, rawLength: raw.length });
  }
  return parts;
}
