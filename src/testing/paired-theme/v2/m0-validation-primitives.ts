export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const SHA1_PATTERN = /^[0-9a-f]{40}$/;
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const CANONICAL_RFC3339_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>, expected: readonly string[], label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

export function literal<T>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must equal ${String(expected)}`);
  return expected;
}

export function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be non-empty`);
  }
  return value;
}

export function match(value: unknown, pattern: RegExp, label: string): string {
  const result = nonEmpty(value, label);
  if (!pattern.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

export function sha256Digest(value: unknown, label: string): string {
  return match(value, SHA256_PATTERN, label);
}

export function sha1Digest(value: unknown, label: string): string {
  return match(value, SHA1_PATTERN, label);
}

export function canonicalTimestamp(value: unknown, label: string): string {
  const result = match(value, CANONICAL_RFC3339_PATTERN, label);
  const instant = new Date(result);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString() !== result) {
    throw new TypeError(`${label} is not a canonical RFC3339 instant`);
  }
  return result;
}

export function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value as number;
}

export function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value as number;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
