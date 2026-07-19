import type {Browser, BrowserContextOptions} from 'playwright';

import {parseCssColor} from '../../color';
import type {PaintObservation, SceneDefinition} from './types';

export interface ComputedPaintCollectionInput {
  html: string;
  scenes: readonly SceneDefinition[];
  viewport: {width: number; height: number; deviceScaleFactor: number};
  locale: string;
}

export type ComputedPaintRow = Omit<PaintObservation, 'schema' | 'system' | 'split' | 'variant'>;

interface BrowserPaintDescriptor {
  sceneId: string;
  paintId: string;
  backdropPaintId: string | null;
  property: PaintObservation['property'];
  pseudo: PaintObservation['pseudo'];
}

interface BrowserPaintResult {
  sceneId: string;
  paintId: string;
  value: string;
  opacity: string;
  display: string;
  visibility: string;
  rect: PaintObservation['rect'];
}

/** Collect schema-neutral Chrome computed-paint facts for one rendered condition. */
export async function collectComputedPaintRows(
  browser: Browser,
  input: ComputedPaintCollectionInput,
): Promise<ComputedPaintRow[]> {
  const contextOptions: BrowserContextOptions = {
    viewport: {width: input.viewport.width, height: input.viewport.height},
    deviceScaleFactor: input.viewport.deviceScaleFactor,
    locale: input.locale,
    colorScheme: 'light',
  };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  try {
    await page.setContent(input.html, {waitUntil: 'load'});
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve()),
      ));
    });
    const descriptors = descriptorsFor(input.scenes);
    const raw = await page.evaluate((browserDescriptors: BrowserPaintDescriptor[]): BrowserPaintResult[] => {
      const nodes = new Map<string, Element>();
      for (const element of document.querySelectorAll('[data-paint-id]')) {
        const paintId = element.getAttribute('data-paint-id');
        if (!paintId) throw new Error('Rendered paint node has no id');
        if (nodes.has(paintId)) throw new Error(`Duplicate rendered paint node: ${paintId}`);
        nodes.set(paintId, element);
      }
      if (nodes.size !== browserDescriptors.length) {
        throw new Error(`Rendered paint count ${nodes.size} does not match ${browserDescriptors.length}`);
      }
      return browserDescriptors.map((descriptor) => {
        const element = nodes.get(descriptor.paintId);
        if (!element) throw new Error(`Missing rendered paint node: ${descriptor.paintId}`);
        if (element.getAttribute('data-scene-id') !== descriptor.sceneId) {
          throw new Error(`Scene identity mismatch for ${descriptor.paintId}`);
        }
        const parent = element.parentElement?.closest('[data-paint-id]') ?? null;
        const parentId = parent?.getAttribute('data-paint-id') ?? null;
        if (parentId !== descriptor.backdropPaintId) {
          throw new Error(`Backdrop DOM mismatch for ${descriptor.paintId}`);
        }
        const style = getComputedStyle(element, descriptor.pseudo);
        if (descriptor.pseudo !== null && (style.content === 'none' || style.content === 'normal')) {
          throw new Error(`Pseudo paint ${descriptor.paintId}${descriptor.pseudo} has no generated box`);
        }
        if (style.opacity !== '1' || style.filter !== 'none' ||
            style.backdropFilter !== 'none' || style.mixBlendMode !== 'normal') {
          throw new Error(`Unsupported paint effect on ${descriptor.paintId}${descriptor.pseudo ?? ''}`);
        }
        for (let current: Element | null = element; current; current = current.parentElement) {
          const ancestorStyle = getComputedStyle(current);
          if (ancestorStyle.opacity !== '1' || ancestorStyle.filter !== 'none' ||
              ancestorStyle.backdropFilter !== 'none' || ancestorStyle.mixBlendMode !== 'normal') {
            throw new Error(`Unsupported ancestor effect for ${descriptor.paintId}`);
          }
        }
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) throw new Error(`Paint ${descriptor.paintId} has no box`);
        const value = style.getPropertyValue(descriptor.property).trim();
        if (!value) throw new Error(`Paint ${descriptor.paintId} has no computed ${descriptor.property}`);
        return {
          sceneId: descriptor.sceneId,
          paintId: descriptor.paintId,
          value,
          opacity: style.opacity,
          display: style.display,
          visibility: style.visibility,
          rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
        };
      });
    }, descriptors);
    return rowsFrom(raw, descriptors, input.scenes);
  } finally {
    await context.close();
  }
}

function descriptorsFor(scenes: readonly SceneDefinition[]): BrowserPaintDescriptor[] {
  return scenes.flatMap((scene) => scene.paints.map((paint) => ({
    sceneId: scene.id,
    paintId: paint.id,
    backdropPaintId: paint.backdropPaintId,
    property: paint.property,
    pseudo: paint.pseudo,
  }))).sort((left, right) => compare(
    `${left.sceneId}\0${left.paintId}`,
    `${right.sceneId}\0${right.paintId}`,
  ));
}

function rowsFrom(
  raw: readonly BrowserPaintResult[],
  descriptors: readonly BrowserPaintDescriptor[],
  scenes: readonly SceneDefinition[],
): ComputedPaintRow[] {
  const rawById = new Map(raw.map((row) => [row.paintId, row]));
  if (rawById.size !== raw.length) throw new Error('Chrome returned duplicate paint observations');
  const definitions = new Map(scenes.flatMap((scene) =>
    scene.paints.map((paint) => [paint.id, paint] as const),
  ));
  return descriptors.map((descriptor) => {
    const row = rawById.get(descriptor.paintId);
    const paint = definitions.get(descriptor.paintId);
    if (!row || !paint) throw new Error(`Missing collected paint: ${descriptor.paintId}`);
    if (!parseCssColor(row.value)) {
      throw new Error(`Chrome returned an unsupported color for ${row.paintId}: ${row.value}`);
    }
    if (row.opacity !== '1' || row.display === 'none' || row.visibility !== 'visible') {
      throw new Error(`Paint ${row.paintId} is not a visible unit-opacity target`);
    }
    return {
      sceneId: row.sceneId,
      paintId: row.paintId,
      component: paint.component,
      state: paint.state,
      property: paint.property,
      pseudo: paint.pseudo,
      role: paint.role,
      backdropPaintId: paint.backdropPaintId,
      contrastKind: paint.contrastKind,
      reviewed: paint.reviewed,
      value: row.value,
      opacity: row.opacity,
      display: row.display,
      visibility: row.visibility,
      rect: row.rect,
    };
  });
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
