import {serializeCanonicalJson, sha256Text} from '../../artifacts';
import type {
  MaterialProtocolSource,
  NormalizedThemePair,
  PrimerProtocolSource,
  SpectrumProtocolSource,
} from '../types';
import {
  assertValidatedV2EvaluationContract,
  requireRegisteredSystem,
  type ValidatedV2EvaluationContract,
} from './contract';
import type {V2NormalizedThemePair} from './exported-theme-source';
import {
  assertLoadedV2RegisteredProtocol,
  type LoadedV2RegisteredProtocol,
} from './protocol';

export const V2_ADAPTER_IDS = {
  material: 'material-color-utilities-v2',
  primer: 'primer-primitives-v2',
  spectrum: 'spectrum-design-data-v2',
  exportedObject: 'exported-theme-object-v2',
} as const;

export interface V2ResolvedThemeSource {
  theme: V2NormalizedThemePair;
  normalizedTokensSha256: string;
}

/** Resolve development systems; registry purpose and adapter ID are authenticated first. */
export async function resolveV2DevelopmentSource(
  contract: ValidatedV2EvaluationContract,
  loaded: LoadedV2RegisteredProtocol,
): Promise<V2ResolvedThemeSource> {
  assertValidatedV2EvaluationContract(contract);
  const entry = matchingEntry(contract, loaded);
  if (entry.purpose !== 'development') {
    throw new Error(`System ${entry.id} is not a development system`);
  }
  return resolveRegisteredAdapter(loaded);
}

async function resolveRegisteredAdapter(
  loaded: LoadedV2RegisteredProtocol,
): Promise<V2ResolvedThemeSource> {
  const source = loaded.sourceConfig;
  let theme: V2NormalizedThemePair;
  switch (loaded.registry.adapterId) {
    case V2_ADAPTER_IDS.material: {
      if (source.kind !== 'generated-scheme') throw kindMismatch(loaded, source.kind);
      const {materialThemePair} = await import('../material');
      theme = materialThemePair({system: 'material', ...source} as MaterialProtocolSource);
      break;
    }
    case V2_ADAPTER_IDS.primer: {
      if (source.kind !== 'static-token-json') throw kindMismatch(loaded, source.kind);
      const {primerThemePair} = await import('../primer');
      theme = primerThemePair({system: 'primer', ...source} as PrimerProtocolSource);
      break;
    }
    case V2_ADAPTER_IDS.spectrum: {
      if (source.kind !== 'cascade-token-json') throw kindMismatch(loaded, source.kind);
      const {spectrumThemePair} = await import('../spectrum');
      theme = spectrumThemePair({system: 'spectrum', ...source} as SpectrumProtocolSource);
      break;
    }
    case V2_ADAPTER_IDS.exportedObject: {
      if (source.kind !== 'exported-theme-object') throw kindMismatch(loaded, source.kind);
      const {loadV2ExportedThemePair} = await import('./exported-theme-source');
      theme = loadV2ExportedThemePair(loaded);
      break;
    }
    default:
      throw new Error(`Unknown frozen v2 adapter: ${loaded.registry.adapterId}`);
  }
  const frozenTheme = deepFreeze(theme);
  if (frozenTheme.system !== loaded.registry.id || frozenTheme.split !== loaded.registry.split) {
    throw new Error(`V2 adapter result identity mismatch for ${loaded.registry.id}`);
  }
  return Object.freeze({
    theme: frozenTheme,
    normalizedTokensSha256: normalizedTokenHash(frozenTheme),
  });
}

function matchingEntry(
  contract: ValidatedV2EvaluationContract,
  loaded: LoadedV2RegisteredProtocol,
) {
  assertLoadedV2RegisteredProtocol(loaded);
  if (loaded.metricSpecSha256 !== contract.metricSpecSha256) {
    throw new Error('Loaded v2 protocol belongs to a different metric spec');
  }
  const entry = requireRegisteredSystem(contract, loaded.registry.id, loaded.registry.split);
  if (entry !== loaded.registry || loaded.protocol.id !== entry.id ||
      loaded.protocol.adapterId !== entry.adapterId || loaded.protocolSha256 !== entry.protocolSha256) {
    throw new Error(`Loaded v2 protocol is not the authenticated registry entry for ${entry.id}`);
  }
  return entry;
}

function normalizedTokenHash(theme: Pick<NormalizedThemePair, 'tokens'>): string {
  return sha256Text(serializeCanonicalJson(theme.tokens));
}

function kindMismatch(loaded: LoadedV2RegisteredProtocol, actual: string): Error {
  return new Error(`Adapter ${loaded.registry.adapterId} rejects source kind ${actual}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
