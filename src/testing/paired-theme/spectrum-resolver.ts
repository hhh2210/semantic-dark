import {parseCssColor} from '../../color';

export type SpectrumColorMode = 'light' | 'dark';
export type SpectrumTokenDocument = readonly unknown[];

export interface SpectrumColorResolution {
  color: string;
  resolutionPath: readonly string[];
}

export interface SpectrumColorResolver {
  readonly mode: SpectrumColorMode;
  resolve(reference: string): SpectrumColorResolution;
}

interface SpectrumToken extends Readonly<Record<string, unknown>> {
  readonly uuid: string;
}

interface SpectrumIndexes {
  tokens: ReadonlyMap<string, SpectrumToken>;
  sets: ReadonlyMap<string, readonly SpectrumToken[]>;
}

/** Build a deterministic, IO-free resolver over already-loaded Spectrum cascade documents. */
export function createSpectrumColorResolver(
  documents: readonly SpectrumTokenDocument[],
  mode: SpectrumColorMode,
): SpectrumColorResolver {
  if (mode !== 'light' && mode !== 'dark') {
    throw new Error(`Unsupported Spectrum color mode: ${String(mode)}`);
  }
  const indexes = buildIndexes(documents);
  return {
    mode,
    resolve(reference: string): SpectrumColorResolution {
      if (!isNonEmptyString(reference)) {
        throw new Error('Spectrum resolution reference must be a non-empty string');
      }
      return resolveReference(reference, indexes, mode, [], new Set());
    },
  };
}

function buildIndexes(documents: readonly SpectrumTokenDocument[]): SpectrumIndexes {
  if (!Array.isArray(documents)) {
    throw new Error('Spectrum token documents must be an array');
  }
  const tokenBuckets = new Map<string, SpectrumToken[]>();
  const setBuckets = new Map<string, SpectrumToken[]>();

  for (const [documentIndex, document] of documents.entries()) {
    if (!Array.isArray(document)) {
      throw new Error(`Spectrum token document ${documentIndex} must be an array`);
    }
    for (const [tokenIndex, value] of document.entries()) {
      if (!isRecord(value) || !isNonEmptyString(value.uuid)) {
        throw new Error(
          `Spectrum token at document ${documentIndex}, index ${tokenIndex} lacks a UUID`,
        );
      }
      const token = value as SpectrumToken;
      pushBucket(tokenBuckets, token.uuid, token);
      if (Object.hasOwn(token, 'set_uuid')) {
        if (!isNonEmptyString(token.set_uuid)) {
          throw new Error(`Spectrum token ${token.uuid} has an invalid set_uuid`);
        }
        pushBucket(setBuckets, token.set_uuid, token);
      }
    }
  }

  const duplicateUuids = [...tokenBuckets]
    .filter(([, tokens]) => tokens.length > 1)
    .map(([uuid]) => uuid)
    .sort();
  if (duplicateUuids.length > 0) {
    throw new Error(`Duplicate Spectrum token UUID: ${duplicateUuids.join(', ')}`);
  }

  const namespaceCollisions = [...setBuckets.keys()]
    .filter((setUuid) => tokenBuckets.has(setUuid))
    .sort();
  if (namespaceCollisions.length > 0) {
    throw new Error(
      `Ambiguous Spectrum token/set UUID: ${namespaceCollisions.join(', ')}`,
    );
  }

  const tokens = new Map(
    [...tokenBuckets]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([uuid, bucket]) => [uuid, bucket[0]!] as const),
  );
  const sets = new Map(
    [...setBuckets]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([uuid, members]) => [
        uuid,
        [...members].sort((left, right) => left.uuid.localeCompare(right.uuid)),
      ] as const),
  );
  return {tokens, sets};
}

function resolveReference(
  reference: string,
  indexes: SpectrumIndexes,
  mode: SpectrumColorMode,
  path: readonly string[],
  active: Set<string>,
): SpectrumColorResolution {
  if (active.has(reference)) {
    throw new Error(`Spectrum reference cycle: ${[...path, reference].join(' -> ')}`);
  }
  const token = indexes.tokens.get(reference);
  const setMembers = indexes.sets.get(reference);
  if (!token && !setMembers) {
    throw new Error(
      `Missing Spectrum reference ${reference} from ${path.length > 0 ? path.join(' -> ') : '<root>'}`,
    );
  }

  active.add(reference);
  const nextPath = [...path, reference];
  try {
    if (setMembers) {
      const selected = selectSetMember(reference, setMembers, mode);
      return resolveReference(selected.uuid, indexes, mode, nextPath, active);
    }
    return resolveToken(token!, indexes, mode, nextPath, active);
  } finally {
    active.delete(reference);
  }
}

function resolveToken(
  token: SpectrumToken,
  indexes: SpectrumIndexes,
  mode: SpectrumColorMode,
  path: readonly string[],
  active: Set<string>,
): SpectrumColorResolution {
  const hasValue = Object.hasOwn(token, 'value');
  const hasReference = Object.hasOwn(token, '$ref');
  if (hasValue === hasReference) {
    throw new Error(
      `Spectrum token ${token.uuid} must define exactly one of value or $ref`,
    );
  }
  if (hasReference) {
    if (!isNonEmptyString(token.$ref)) {
      throw new Error(`Spectrum token ${token.uuid} has an invalid $ref`);
    }
    return resolveReference(token.$ref, indexes, mode, path, active);
  }
  if (typeof token.value !== 'string' || !parseCssColor(token.value)) {
    throw new Error(`Spectrum token ${token.uuid} does not resolve to a CSS color`);
  }
  return {color: token.value, resolutionPath: path};
}

function selectSetMember(
  setUuid: string,
  members: readonly SpectrumToken[],
  mode: SpectrumColorMode,
): SpectrumToken {
  const selected = members.filter((member) => readColorScheme(member) === mode);
  if (selected.length === 0) {
    throw new Error(`Spectrum set ${setUuid} has no member for colorScheme=${mode}`);
  }
  if (selected.length > 1) {
    throw new Error(
      `Spectrum set ${setUuid} has ambiguous members for colorScheme=${mode}: ` +
      selected.map((member) => member.uuid).sort().join(', '),
    );
  }
  return selected[0]!;
}

function readColorScheme(token: SpectrumToken): unknown {
  if (!isRecord(token.name) || !Object.hasOwn(token.name, 'colorScheme')) return 'light';
  return token.name.colorScheme;
}

function pushBucket<T>(buckets: Map<string, T[]>, key: string, value: T): void {
  const bucket = buckets.get(key);
  if (bucket) bucket.push(value);
  else buckets.set(key, [value]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
