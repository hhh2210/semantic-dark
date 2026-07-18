import {formatCssColor, parseCssColor} from '../../color';
import type {PaintDecision, PaintProperty, SceneDefinition} from './types';

export type PaintValueMap = Readonly<Record<string, string>>;

export interface PairedThemeRenderInput {
  title: string;
  scenes: readonly SceneDefinition[];
  paintValues: PaintValueMap;
}

interface RenderContext {
  values: ReadonlyMap<string, string>;
  nodeIds: ReadonlyMap<string, string>;
  pseudoRules: string[];
}

/** Render the frozen scene DAG as a deterministic, self-contained HTML document. */
export function renderPairedThemeDocument(input: PairedThemeRenderInput): string {
  if (!input.title) throw new Error('Render title is required');
  const scenes = [...input.scenes].sort((left, right) => compare(left.id, right.id));
  const paints = validateInventory(scenes, input.paintValues);
  const values = new Map(paints.map((paint) => [paint.id, normalizeColor(
    input.paintValues[paint.id]!,
    paint.id,
  )]));
  const nodeIds = new Map(paints.map((paint, index) => [paint.id, `paired-paint-${index + 1}`]));
  const context: RenderContext = {values, nodeIds, pseudoRules: []};
  const sceneMarkup = scenes.map((scene) => renderScene(scene, context)).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
${BASE_STYLES}
${context.pseudoRules.join('\n')}
</style>
</head>
<body>
<main><h1>${escapeHtml(input.title)}</h1><div class="scene-grid">${sceneMarkup}</div></main>
</body>
</html>
`;
}

function renderScene(scene: SceneDefinition, context: RenderContext): string {
  const byId = new Map(scene.paints.map((paint) => [paint.id, paint]));
  const children = new Map<string | null, PaintDecision[]>();
  for (const paint of scene.paints) {
    const siblings = children.get(paint.backdropPaintId) ?? [];
    siblings.push(paint);
    children.set(paint.backdropPaintId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => compare(a.id, b.id));

  const visiting = new Set<string>();
  const renderPaint = (paint: PaintDecision): string => {
    if (visiting.has(paint.id)) throw new Error(`Backdrop cycle while rendering ${paint.id}`);
    visiting.add(paint.id);
    const nodeId = context.nodeIds.get(paint.id)!;
    const color = context.values.get(paint.id)!;
    const declarations = paintDeclarations(paint.property, 'var(--paired-theme-paint)');
    if (paint.pseudo !== null) {
      context.pseudoRules.push(
        `#${nodeId}${paint.pseudo}{content:"";display:block;min-width:32px;min-height:18px;` +
        `${declarations}}`,
      );
    }
    const childMarkup = (children.get(paint.id) ?? []).map(renderPaint).join('');
    visiting.delete(paint.id);
    const labelClass = paint.property === 'color' && paint.pseudo === null
      ? 'paint-label target-text'
      : 'paint-label meta-label';
    return `<div id="${nodeId}" class="paint role-${escapeHtml(paint.role)}"` +
      ` data-scene-id="${escapeHtml(scene.id)}" data-paint-id="${escapeHtml(paint.id)}"` +
      ` data-pseudo="${escapeHtml(paint.pseudo ?? '')}"` +
      ` style="--paired-theme-paint:${escapeHtml(color)};` +
      `${paint.pseudo === null ? declarations : ''}">` +
      `<span class="${labelClass}">${escapeHtml(paint.component)} · ${escapeHtml(paint.state)}</span>` +
      `${childMarkup}</div>`;
  };

  const roots = (children.get(null) ?? []).map(renderPaint).join('');
  if (!roots || byId.size === 0) throw new Error(`Scene ${scene.id} has no root paint`);
  return `<section class="scene" data-scene="${escapeHtml(scene.id)}">` +
    `<h2>${escapeHtml(scene.title)}</h2><div class="scene-body">${roots}</div></section>`;
}

function validateInventory(
  scenes: readonly SceneDefinition[],
  paintValues: PaintValueMap,
): PaintDecision[] {
  const sceneIds = new Set<string>();
  const paintIds = new Set<string>();
  const paints: PaintDecision[] = [];
  for (const scene of scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    for (const paint of scene.paints) {
      if (paintIds.has(paint.id)) throw new Error(`Duplicate paint id: ${paint.id}`);
      paintIds.add(paint.id);
      paints.push(paint);
    }
  }
  if (paints.length === 0) throw new Error('At least one paint is required');
  for (const paint of paints) {
    if (!(paint.id in paintValues)) throw new Error(`Missing paint value: ${paint.id}`);
  }
  for (const paintId of Object.keys(paintValues)) {
    if (!paintIds.has(paintId)) throw new Error(`Unexpected paint value: ${paintId}`);
  }
  return paints.sort((left, right) => compare(left.id, right.id));
}

function normalizeColor(value: string, paintId: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) throw new Error(`Paint ${paintId} is not a resolved CSS color: ${value}`);
  return formatCssColor(parsed);
}

function paintDeclarations(property: PaintProperty, value: string): string {
  if (property === 'border-color') {
    return `border-style:solid;border-width:3px;border-color:${value};`;
  }
  if (property === 'outline-color') {
    return `outline-style:solid;outline-width:3px;outline-offset:2px;outline-color:${value};`;
  }
  return `${property}:${value};`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const BASE_STYLES = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:#e8ebf1;color:#172033}
main{max-width:1180px;margin:0 auto;padding:32px}
h1{font-size:24px;margin:0 0 24px}
.scene-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.scene{border-radius:16px;background:#fff;padding:16px;box-shadow:0 1px 3px #0002}
.scene h2{font-size:15px;margin:0 0 12px}
.scene-body{min-height:150px}
.paint{position:relative;display:block;min-width:80px;min-height:40px;padding:12px;margin:7px;border-radius:10px}
.paint-label{display:inline-block;font-size:12px;line-height:1.25}
.meta-label{padding:3px 6px;border-radius:6px;background:rgb(0 0 0 / .68);color:#fff!important}
@media(max-width:760px){.scene-grid{grid-template-columns:1fr}}
`;
