const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9.-]*$/;

export function specObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function specExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

export function specString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function specIdentifier(value: unknown, label: string): string {
  const result = specString(value, label);
  if (!IDENTIFIER.test(result)) throw new TypeError(`${label} must be an identifier`);
  return result;
}

export function specDigest(value: unknown, label: string): string {
  const result = specString(value, label);
  if (!SHA256.test(result)) throw new TypeError(`${label} must be a lowercase SHA-256`);
  return result;
}

export function specFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return value;
}

export function specExactNumber<T extends number>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must equal ${expected}`);
  return expected;
}

export function specExactString<T extends string>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) throw new Error(`${label} must equal ${expected}`);
  return expected;
}

export function specStringArray(
  value: unknown,
  label: string,
  options: {length?: number; identifiers?: boolean} = {},
): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (options.length !== undefined && value.length !== options.length) {
    throw new Error(`${label} must contain exactly ${options.length} entries`);
  }
  const result = value.map((item, index) => options.identifiers
    ? specIdentifier(item, `${label}[${index}]`)
    : specString(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
}

export function specExactArray<T extends string>(
  value: unknown,
  expected: readonly T[],
  label: string,
): readonly T[] {
  if (!Array.isArray(value) || value.length !== expected.length ||
      value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} must equal ${expected.join(', ')}`);
  }
  return [...expected];
}

export function specBoolean(value: unknown, expected: boolean, label: string): boolean {
  if (value !== expected) throw new Error(`${label} must equal ${expected}`);
  return expected;
}
