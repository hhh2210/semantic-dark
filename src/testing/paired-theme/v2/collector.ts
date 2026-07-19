import type {Browser} from 'playwright';

import {collectComputedPaintRows} from '../computed-style-collector';
import type {EvaluationSplit, SceneDefinition} from '../types';
import type {V2PaintObservation} from './observations';

export interface V2PaintCollectionInput {
  html: string;
  system: string;
  split: EvaluationSplit;
  variant: string;
  scenes: readonly SceneDefinition[];
  viewport: {width: number; height: number; deviceScaleFactor: number};
  locale: string;
}

export async function collectV2PaintObservations(
  browser: Browser,
  input: V2PaintCollectionInput,
): Promise<V2PaintObservation[]> {
  const rows = await collectComputedPaintRows(browser, input);
  return rows.map((row) => ({
    schema: 'semantic-dark.paint-observation.v2',
    system: input.system,
    split: input.split,
    variant: input.variant,
    ...row,
  }));
}
