import {
  DEFAULT_DARK_BACKGROUND,
  compositeSrgb,
  formatCssColor,
  mapRoleColorWithReport,
  parseCssColor,
  type SrgbColor,
} from '../../color';
import type {NormalizedTokenName, SceneDefinition} from './types';

export type LightTokenMap = Readonly<Partial<Record<NormalizedTokenName, string>>>;

export interface CandidateContrastReport {
  minimum: number;
  achieved: number;
  adjusted: boolean;
}

export interface CandidatePaintMapping {
  sceneId: string;
  paintId: string;
  token: NormalizedTokenName;
  backdropPaintId: string | null;
  sourceLightColor: SrgbColor;
  mappedColor: SrgbColor;
  mappedCss: string;
  effectiveColor: SrgbColor;
  contrast: CandidateContrastReport;
}

/**
 * Map only the light half of a normalized theme through the frozen production
 * engine. Authored dark tokens are deliberately absent from this API.
 */
export function mapCandidateTheme(
  lightTokens: LightTokenMap,
  scenes: readonly SceneDefinition[],
): CandidatePaintMapping[] {
  const seenSceneIds = new Set<string>();
  const seenPaintIds = new Set<string>();

  for (const scene of scenes) {
    if (seenSceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    seenSceneIds.add(scene.id);
    for (const paint of scene.paints) {
      if (seenPaintIds.has(paint.id)) throw new Error(`Duplicate paint id: ${paint.id}`);
      seenPaintIds.add(paint.id);
    }
  }

  return [...scenes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((scene) => mapScene(lightTokens, scene));
}

function mapScene(lightTokens: LightTokenMap, scene: SceneDefinition): CandidatePaintMapping[] {
  const paints = new Map(scene.paints.map((paint) => [paint.id, paint]));
  for (const paint of scene.paints) {
    if (paint.backdropPaintId !== null && !paints.has(paint.backdropPaintId)) {
      throw new Error(`Unknown backdrop ${paint.backdropPaintId} for ${paint.id}`);
    }
  }

  const completed = new Map<string, CandidatePaintMapping>();
  const visiting = new Set<string>();
  const stack: string[] = [];

  const resolve = (paintId: string): CandidatePaintMapping => {
    const cached = completed.get(paintId);
    if (cached) return cached;
    if (visiting.has(paintId)) {
      const cycleStart = stack.indexOf(paintId);
      const cycle = [...stack.slice(cycleStart), paintId].join(' -> ');
      throw new Error(`Backdrop cycle in scene ${scene.id}: ${cycle}`);
    }

    const paint = paints.get(paintId);
    if (!paint) throw new Error(`Unknown paint ${paintId} in scene ${scene.id}`);
    visiting.add(paintId);
    stack.push(paintId);

    const backdrop = paint.backdropPaintId === null ? null : resolve(paint.backdropPaintId);
    const tokenValue = lightTokens[paint.token];
    if (typeof tokenValue !== 'string') {
      throw new Error(`Missing light token ${paint.token} for paint ${paint.id}`);
    }
    const sourceLightColor = parseCssColor(tokenValue);
    if (!sourceLightColor) {
      throw new Error(`Invalid light token ${paint.token} for paint ${paint.id}: ${tokenValue}`);
    }

    const against = backdrop?.effectiveColor ?? DEFAULT_DARK_BACKGROUND;
    const mappedReport = mapRoleColorWithReport(sourceLightColor, {
      role: paint.role,
      ...(backdrop === null ? {} : {against}),
    });
    const mappedColor = mappedReport.color;
    const result: CandidatePaintMapping = {
      sceneId: scene.id,
      paintId: paint.id,
      token: paint.token,
      backdropPaintId: paint.backdropPaintId,
      sourceLightColor,
      mappedColor,
      mappedCss: formatCssColor(mappedColor),
      effectiveColor: backdrop === null
        ? mappedColor
        : compositeSrgb(mappedColor, backdrop.effectiveColor),
      contrast: {
        minimum: mappedReport.minimumContrast,
        achieved: mappedReport.achievedContrast,
        adjusted: mappedReport.adjustedForContrast,
      },
    };

    stack.pop();
    visiting.delete(paintId);
    completed.set(paintId, result);
    return result;
  };

  return [...paints.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map(resolve);
}
