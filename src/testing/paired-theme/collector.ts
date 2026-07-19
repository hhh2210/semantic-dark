import type {Browser} from 'playwright';

import {collectComputedPaintRows} from './computed-style-collector';
import type {
  EvaluationSplit,
  ObservationVariant,
  PaintObservation,
  PairedThemeSystem,
  SceneDefinition,
} from './types';

export interface PaintCollectionInput {
  html: string;
  system: PairedThemeSystem;
  split: EvaluationSplit;
  variant: ObservationVariant;
  scenes: readonly SceneDefinition[];
  viewport: {width: number; height: number; deviceScaleFactor: number};
  locale: string;
}

/** V1 wrapper; computed-style collection itself is schema-neutral. */
export async function collectPaintObservations(
  browser: Browser,
  input: PaintCollectionInput,
): Promise<PaintObservation[]> {
  const rows = await collectComputedPaintRows(browser, input);
  return rows.map((row) => ({
    schema: 'semantic-dark.paint-observation.v1',
    system: input.system,
    split: input.split,
    variant: input.variant,
    ...row,
  }));
}
