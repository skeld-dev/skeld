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
  for (const raw of rawPath.slice(1).split('/')) {
    const text = decodeSegment(raw);
    if (text === null) {
      return null;
    }
    parts.push({ text, rawLength: raw.length });
  }
  return parts;
}
