import {compositeSrgb, parseCssColor, type SrgbColor} from '../../color';
import type {
  EvaluationSplit,
  ObservationVariant,
  PaintObservation,
  PairedThemeSystem,
  SceneDefinition,
} from './types';

export const REQUIRED_OBSERVATION_VARIANTS = [
  'light',
  'authored-dark',
  'baseline-candidate',
] as const satisfies readonly ObservationVariant[];

const ALPHA_EPSILON = 1e-12;

export interface EffectivePaintObservation {
  observation: PaintObservation;
  declaredColor: SrgbColor;
  backdropEffectiveColor: SrgbColor | null;
  effectiveColor: SrgbColor;
}

export interface PairedThemeObservationMatrix {
  system: PairedThemeSystem;
  split: EvaluationSplit;
  variants: Readonly<Record<ObservationVariant, readonly EffectivePaintObservation[]>>;
}

export interface ObservationMatrixInput {
  system: PairedThemeSystem;
  split: EvaluationSplit;
  scenes: readonly SceneDefinition[];
  observations: readonly PaintObservation[];
}

/** Validate the complete three-variant matrix, then resolve effective paints from Chrome output. */
export function buildObservationMatrix(input: ObservationMatrixInput): PairedThemeObservationMatrix {
  const definitions = paintDefinitions(input.scenes);
  const expectedCount = definitions.size * REQUIRED_OBSERVATION_VARIANTS.length;
  if (input.observations.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} observations, received ${input.observations.length}`);
  }

  const byVariant = new Map<ObservationVariant, Map<string, PaintObservation>>();
  for (const variant of REQUIRED_OBSERVATION_VARIANTS) byVariant.set(variant, new Map());
  for (const observation of input.observations) {
    validateObservationIdentity(observation, input, definitions);
    const rows = byVariant.get(observation.variant);
    if (!rows) throw new Error(`Unexpected observation variant: ${observation.variant}`);
    if (rows.has(observation.paintId)) {
      throw new Error(`Duplicate observation: ${observation.variant}/${observation.paintId}`);
    }
    rows.set(observation.paintId, observation);
  }

  const variants = Object.fromEntries(REQUIRED_OBSERVATION_VARIANTS.map((variant) => {
    const rows = byVariant.get(variant)!;
    for (const paintId of definitions.keys()) {
      if (!rows.has(paintId)) throw new Error(`Missing observation: ${variant}/${paintId}`);
    }
    return [variant, resolveVariant(input.scenes, rows)];
  })) as unknown as PairedThemeObservationMatrix['variants'];
  return {system: input.system, split: input.split, variants};
}

export function effectivePaintMap(
  matrix: PairedThemeObservationMatrix,
  variant: ObservationVariant,
): ReadonlyMap<string, EffectivePaintObservation> {
  return new Map(matrix.variants[variant].map((paint) => [paint.observation.paintId, paint]));
}

function resolveVariant(
  scenes: readonly SceneDefinition[],
  observations: ReadonlyMap<string, PaintObservation>,
): EffectivePaintObservation[] {
  const completed = new Map<string, EffectivePaintObservation>();
  for (const scene of scenes) {
    const localIds = new Set(scene.paints.map((paint) => paint.id));
    const visiting = new Set<string>();
    const resolve = (paintId: string): EffectivePaintObservation => {
      const cached = completed.get(paintId);
      if (cached) return cached;
      if (visiting.has(paintId)) throw new Error(`Backdrop cycle while resolving ${paintId}`);
      const observation = observations.get(paintId);
      if (!observation || !localIds.has(paintId)) throw new Error(`Unknown paint ${paintId}`);
      visiting.add(paintId);
      const declaredColor = parseCssColor(observation.value);
      if (!declaredColor) throw new Error(`Unresolved computed color for ${paintId}: ${observation.value}`);
      const backdrop = observation.backdropPaintId === null
        ? null
        : resolve(observation.backdropPaintId);
      const effectiveColor = backdrop === null
        ? declaredColor
        : compositeSrgb(declaredColor, backdrop.effectiveColor);
      if (Math.abs(effectiveColor.a - 1) > ALPHA_EPSILON) {
        throw new Error(`Paint ${paintId} is not opaque after backdrop compositing`);
      }
      const result: EffectivePaintObservation = {
        observation,
        declaredColor,
        backdropEffectiveColor: backdrop?.effectiveColor ?? null,
        effectiveColor: {...effectiveColor, a: 1},
      };
      visiting.delete(paintId);
      completed.set(paintId, result);
      return result;
    };
    for (const paint of scene.paints) resolve(paint.id);
  }
  return [...completed.values()].sort((left, right) => compare(
    `${left.observation.sceneId}\0${left.observation.paintId}`,
    `${right.observation.sceneId}\0${right.observation.paintId}`,
  ));
}

function paintDefinitions(scenes: readonly SceneDefinition[]): Map<string, SceneDefinition['paints'][number]> {
  const sceneIds = new Set<string>();
  const result = new Map<string, SceneDefinition['paints'][number]>();
  for (const scene of scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    for (const paint of scene.paints) {
      if (result.has(paint.id)) throw new Error(`Duplicate paint id: ${paint.id}`);
      result.set(paint.id, paint);
    }
  }
  if (result.size === 0) throw new Error('Observation matrix has no paints');
  return result;
}

function validateObservationIdentity(
  observation: PaintObservation,
  input: ObservationMatrixInput,
  definitions: ReadonlyMap<string, SceneDefinition['paints'][number]>,
): void {
  if (observation.schema !== 'semantic-dark.paint-observation.v1' ||
      observation.system !== input.system || observation.split !== input.split) {
    throw new Error(`Observation provenance mismatch for ${observation.paintId}`);
  }
  const paint = definitions.get(observation.paintId);
  if (!paint) throw new Error(`Unexpected observation paint: ${observation.paintId}`);
  const expectedScene = input.scenes.find((scene) => scene.paints.some((item) => item.id === paint.id))!;
  const fields = [
    ['sceneId', expectedScene.id, observation.sceneId],
    ['component', paint.component, observation.component],
    ['state', paint.state, observation.state],
    ['property', paint.property, observation.property],
    ['pseudo', paint.pseudo, observation.pseudo],
    ['role', paint.role, observation.role],
    ['backdropPaintId', paint.backdropPaintId, observation.backdropPaintId],
    ['contrastKind', paint.contrastKind, observation.contrastKind],
    ['reviewed', paint.reviewed, observation.reviewed],
  ] as const;
  for (const [field, expected, actual] of fields) {
    if (actual !== expected) throw new Error(`Observation ${field} mismatch for ${paint.id}`);
  }
  const opacity = Number(observation.opacity);
  if (!Number.isFinite(opacity) || Math.abs(opacity - 1) > ALPHA_EPSILON) {
    throw new Error(`Unsupported group opacity for ${paint.id}: ${observation.opacity}`);
  }
  if (observation.display === 'none' || observation.visibility !== 'visible' ||
      !positiveRect(observation.rect)) {
    throw new Error(`Observation target is not visible for ${paint.id}`);
  }
}

function positiveRect(rect: PaintObservation['rect']): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
