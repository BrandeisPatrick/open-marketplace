// Tool results arrive as `unknown`; these narrow them without trusting the shape blindly.

export type Dict = Record<string, unknown>;

export function isDict(x: unknown): x is Dict {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** The value as a plain object, or `{}` so property reads are always safe. */
export function asDict(x: unknown): Dict {
  return isDict(x) ? x : {};
}

/** The value as an object of type T when it is one, else null (shallow check only). */
export function asObject<T extends object>(x: unknown): T | null {
  return isDict(x) ? (x as T) : null;
}

/** The value as an array of objects of type T when it is one, else null. */
export function asList<T extends object>(x: unknown): T[] | null {
  return Array.isArray(x) ? (x.filter(isDict) as T[]) : null;
}

export function asString(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

export function asNumber(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}
