import type {
  V2ConfirmationGroup,
  V2ConfirmationRegistry,
  V2SystemRegistryEntry,
} from './contract';

/** Validate one primary pair plus one or more equally sized, mechanically ordered reserve pairs. */
export function validateV2ConfirmationRegistry(
  value: unknown,
  systems: readonly V2SystemRegistryEntry[],
): V2ConfirmationRegistry {
  const input = object(value, 'registry.confirmation');
  exactKeys(input, ['primary', 'reserves'], 'registry.confirmation');
  const primaryIds = systems.filter((entry) => entry.purpose === 'primary-holdout')
    .map((entry) => entry.id);
  const reserveIds = systems.filter((entry) => entry.purpose === 'reserve').map((entry) => entry.id);
  if (systems.filter((entry) => entry.purpose === 'development').length !== 5 ||
      primaryIds.length !== 2 || reserveIds.length < 2 || reserveIds.length % 2 !== 0) {
    throw new Error(
      'V2 registry requires five development systems, one primary pair, and complete reserve pairs',
    );
  }
  const primary = group(input.primary, 'registry.confirmation.primary');
  if (!sameOrder(primary.systems, primaryIds)) {
    throw new Error('Primary confirmation group differs from registry order');
  }
  if (!Array.isArray(input.reserves) || input.reserves.length === 0) {
    throw new Error('At least one complete reserve confirmation pair is required');
  }
  const groupIds = new Set<string>([primary.id]);
  const reserves = input.reserves.map((item, index) => {
    const result = group(item, `registry.confirmation.reserves[${index}]`);
    if (groupIds.has(result.id)) throw new Error(`Duplicate confirmation group id: ${result.id}`);
    groupIds.add(result.id);
    return result;
  });
  if (!sameOrder(reserves.flatMap((item) => item.systems), reserveIds)) {
    throw new Error('Reserve confirmation groups differ from frozen registry order');
  }
  return {primary, reserves};
}

function group(value: unknown, label: string): V2ConfirmationGroup {
  const input = object(value, label);
  exactKeys(input, ['id', 'systems'], label);
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(input.id)) {
    throw new TypeError(`${label}.id must be a lowercase identifier`);
  }
  if (!Array.isArray(input.systems) || input.systems.length !== 2 ||
      input.systems.some((item) => typeof item !== 'string') ||
      new Set(input.systems).size !== input.systems.length) {
    throw new Error(`${label}.systems must be one ordered pair`);
  }
  return {id: input.id, systems: input.systems as unknown as readonly [string, string]};
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}
