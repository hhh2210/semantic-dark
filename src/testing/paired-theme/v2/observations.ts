import {
  buildObservationMatrix,
  type PairedThemeObservationMatrix,
} from '../observations';
import type {
  EvaluationSplit,
  ObservationVariant,
  PaintObservation,
  PairedThemeSystem,
} from '../types';
import {serializeCanonicalJson, sha256Text} from '../../artifacts';
import {
  assertValidatedV2EvaluationContract,
  requireRegisteredSystem,
  type ValidatedV2EvaluationContract,
} from './contract';
import {
  assertLoadedV2RegisteredProtocol,
  type LoadedV2RegisteredProtocol,
} from './protocol';

const validatedReplicates = new WeakSet<object>();

export type V2PaintObservation = Omit<PaintObservation, 'schema' | 'system' | 'variant'> & {
  schema: 'semantic-dark.paint-observation.v2';
  system: string;
  variant: string;
};

interface V2ObservationReplicateData {
  system: string;
  split: EvaluationSplit;
  replicateId: string;
  metricSpecSha256: string;
  protocolSha256: string;
  sceneManifestSha256: string;
  observationSha256: string;
  rawObservationCount: number;
  baselineMatrix: PairedThemeObservationMatrix;
  candidateMatrix: PairedThemeObservationMatrix;
}

declare const v2ObservationReplicateBrand: unique symbol;

export type V2ObservationReplicate = Readonly<V2ObservationReplicateData> & {
  readonly [v2ObservationReplicateBrand]: true;
};

export interface V2ObservationReplicateInput {
  system: string;
  split: EvaluationSplit;
  replicateId: string;
  observations: readonly V2PaintObservation[];
}

/**
 * Validate one four-condition replicate, then adapt each candidate arm to the
 * unchanged three-condition v1 observation resolver. Variant names are read
 * only from the runtime-validated frozen contract.
 */
export function buildV2ObservationReplicate(
  input: V2ObservationReplicateInput,
  contract: ValidatedV2EvaluationContract,
  loaded: LoadedV2RegisteredProtocol,
): V2ObservationReplicate {
  assertValidatedV2EvaluationContract(contract);
  assertLoadedV2RegisteredProtocol(loaded);
  const registry = requireRegisteredSystem(contract, input.system, input.split);
  if (loaded.metricSpecSha256 !== contract.metricSpecSha256 || loaded.registry !== registry) {
    throw new Error('V2 observations require the registered protocol for the same metric spec');
  }
  if (typeof input.replicateId !== 'string' || input.replicateId.length === 0) {
    throw new Error('V2 replicate id must be a non-empty string');
  }
  const scenes = loaded.scenes.scenes;
  const expected = contract.denominators;
  const paintCount = scenes.reduce((sum, scene) => sum + scene.paints.length, 0);
  if (scenes.length !== expected.scenesPerSystem ||
      paintCount !== expected.paintsPerVariant) {
    throw new Error(
      `V2 scene denominator mismatch: ${scenes.length}/${paintCount}`,
    );
  }

  const allowedVariants = new Set(contract.variants.ordered);
  const byVariant = new Map(contract.variants.ordered.map((variant) =>
    [variant, [] as V2PaintObservation[]] as const));
  for (const observation of input.observations) {
    if (observation.schema !== 'semantic-dark.paint-observation.v2') {
      throw new Error(`Unsupported v2 observation schema for ${observation.paintId}`);
    }
    if (observation.system !== input.system || observation.split !== input.split) {
      throw new Error(`V2 observation provenance mismatch for ${observation.paintId}`);
    }
    if (!allowedVariants.has(observation.variant)) {
      throw new Error(`Unexpected v2 observation variant: ${observation.variant}`);
    }
    byVariant.get(observation.variant)!.push(observation);
  }
  for (const variant of contract.variants.ordered) {
    const rows = byVariant.get(variant)!;
    if (rows.length !== expected.paintsPerVariant) {
      throw new Error(
        `V2 variant ${variant} expected ${expected.paintsPerVariant} observations, received ${rows.length}`,
      );
    }
  }
  if (input.observations.length !== expected.rawObservationsPerSystemPerReplicate) {
    throw new Error(
      `V2 raw observation denominator mismatch: ${input.observations.length}`,
    );
  }

  const roles = contract.variants.roles;
  const baselineMatrix = buildArmMatrix(input, scenes, byVariant, [
    [roles.light, 'light'],
    [roles.authoredDark, 'authored-dark'],
    [roles.baselineCandidate, 'baseline-candidate'],
  ]);
  const candidateMatrix = buildArmMatrix(input, scenes, byVariant, [
    [roles.light, 'light'],
    [roles.authoredDark, 'authored-dark'],
    [roles.m2Candidate, 'baseline-candidate'],
  ]);
  const result = deepFreeze({
    system: input.system,
    split: input.split,
    replicateId: input.replicateId,
    metricSpecSha256: contract.metricSpecSha256,
    protocolSha256: loaded.protocolSha256,
    sceneManifestSha256: loaded.sceneManifestSha256,
    observationSha256: observationSha256(input.observations, contract.variants.ordered),
    rawObservationCount: input.observations.length,
    baselineMatrix,
    candidateMatrix,
  }) as unknown as V2ObservationReplicate;
  validatedReplicates.add(result);
  return result;
}

export function assertValidatedV2ObservationReplicate(
  value: V2ObservationReplicate,
): void {
  if (!validatedReplicates.has(value)) {
    throw new Error('V2 evaluator requires a replicate built from authenticated raw observations');
  }
}

function buildArmMatrix(
  input: V2ObservationReplicateInput,
  scenes: LoadedV2RegisteredProtocol['scenes']['scenes'],
  byVariant: ReadonlyMap<string, readonly V2PaintObservation[]>,
  mapping: readonly (readonly [string, ObservationVariant])[],
): PairedThemeObservationMatrix {
  const observations = mapping.flatMap(([sourceVariant, targetVariant]) =>
    byVariant.get(sourceVariant)!.map((row) => ({
      ...row,
      schema: 'semantic-dark.paint-observation.v1',
      system: input.system as PairedThemeSystem,
      variant: targetVariant,
    } as PaintObservation)),
  );
  return buildObservationMatrix({
    system: input.system as PairedThemeSystem,
    split: input.split,
    scenes,
    observations,
  });
}

function observationSha256(
  observations: readonly V2PaintObservation[],
  variants: readonly string[],
): string {
  const order = new Map(variants.map((variant, index) => [variant, index]));
  const rows = observations.map((row) => [
    order.get(row.variant), row.schema, row.system, row.split, row.variant, row.sceneId,
    row.paintId, row.component, row.state, row.property, row.pseudo, row.role,
    row.backdropPaintId, row.contrastKind, row.reviewed, row.value, row.opacity,
    row.display, row.visibility, row.rect.x, row.rect.y, row.rect.width, row.rect.height,
  ]).sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return sha256Text(serializeCanonicalJson(rows));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
