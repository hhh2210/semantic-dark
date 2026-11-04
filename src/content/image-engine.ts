import {parseCssColor} from '../color';
import {decideAsset, type AssetDecision, type AssetDecisionProvider, type AssetObservation} from '../vision/action-policy';
import {
  classifyVisualResource,
  refineVisualResourceClassification,
  type VisualResourceClassification,
} from '../vision/index';
import type {ThemeConfig} from '../types';
import {transformDiagramImage} from './raster-image';
import {RasterWorkerClient} from './raster-worker-client';
import {upgradeInsecureMedia} from './upgrade-insecure';

const FILTER_ATTRIBUTE = 'data-semantic-dark-image-filter';
const REASON_ATTRIBUTE = 'data-semantic-dark-image-reason';
const ACTION_ATTRIBUTE = 'data-semantic-dark-image-action';
const KIND_ATTRIBUTE = 'data-semantic-dark-image-kind';
const RASTER_ATTRIBUTE = 'data-semantic-dark-raster-status';
const RASTER_TIME_ATTRIBUTE = 'data-semantic-dark-raster-ms';
const RASTER_MAIN_TIME_ATTRIBUTE = 'data-semantic-dark-raster-main-ms';
const RASTER_DISPATCH_TIME_ATTRIBUTE = 'data-semantic-dark-raster-dispatch-ms';
const RASTER_WORKER_TIME_ATTRIBUTE = 'data-semantic-dark-raster-worker-ms';
const RASTER_WORKER_ATTRIBUTE = 'data-semantic-dark-raster-worker';
const READ_ATTRIBUTE = 'data-semantic-dark-image-reading';
const GUARD_ATTRIBUTE = 'data-semantic-dark-image-guard';
const STYLE_ID = 'semantic-dark-image-sheet';
const IMAGE_STYLE = `
img[${GUARD_ATTRIBUTE}] { transition: none !important; }
img[${FILTER_ATTRIBUTE}="dim"]:not([${READ_ATTRIBUTE}]) { filter: brightness(.82) contrast(1.04) !important; }
img[${FILTER_ATTRIBUTE}="recolor"]:not([${READ_ATTRIBUTE}]) { filter: brightness(0) invert(.92) !important; }
:root[data-semantic-dark-active] img[${FILTER_ATTRIBUTE}="backplate"]:not([data-semantic-dark-updating]):not([${READ_ATTRIBUTE}]) { background-color: white !important; }
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.setAttribute('data-semantic-dark-sheet', '');
  style.textContent = IMAGE_STYLE;
  (document.head ?? document.documentElement).append(style);
}

export class ImageThemeEngine {
  private config: ThemeConfig;
  private processed = new WeakSet<HTMLImageElement>();
  private readonly touched = new Set<HTMLImageElement>();
  private readonly replacements = new Map<HTMLImageElement, {
    src: string | null;
    srcset: string | null;
    sizes: string | null;
    objectUrl: string;
  }>();
  private readonly rasterWorker = new RasterWorkerClient();
  private rasterAbort = new AbortController();
  private generation = 0;
  private readonly contexts = new Map<HTMLImageElement, string>();
  private watchedAncestors = new WeakSet<Element>();
  private contextRefresh: ReturnType<typeof setTimeout> | null = null;
  private mappingPaused = false;
  private readonly pendingImages = new Set<HTMLImageElement>();
  private readonly retryTimers = new Map<HTMLImageElement, ReturnType<typeof setTimeout>>();
  private intersection: IntersectionObserver | null = null;
  private mutations: MutationObserver | null = null;

  constructor(config: ThemeConfig, private readonly decisionProvider?: AssetDecisionProvider) {
    this.config = config;
  }

  start(): void {
    if (!this.config.enabled) return;
    this.generation += 1;
    if (this.rasterAbort.signal.aborted) this.rasterAbort = new AbortController();
    ensureStyle();
    if ('IntersectionObserver' in globalThis) {
      this.intersection = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLImageElement)) continue;
          this.intersection?.unobserve(entry.target);
          void this.analyze(entry.target, this.generation);
        }
      }, {rootMargin: '300px'});
    }
    this.scan(document);
    this.mutations = new MutationObserver((records) => {
      if (records.length) this.scheduleContextRefresh();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLImageElement) this.queue(node);
          else if (node instanceof Element) this.scan(node);
        }
      }
    });
    this.mutations.observe(document, {subtree: true, childList: true});
  }

  update(config: ThemeConfig): void {
    const wasEnabled = this.config.enabled;
    const modelChanged = config.localModel !== this.config.localModel;
    const paletteChanged = config.background !== this.config.background;
    this.config = config;
    if (!config.enabled) this.stop();
    else if (!wasEnabled) this.start();
    else if (paletteChanged || modelChanged) {
      this.stop();
      this.start();
    }
  }

  setMappingPaused(paused: boolean): void {
    this.mappingPaused = paused;
    if (!paused && this.config.enabled) {
      this.scheduleContextRefresh();
      const pending = [...this.pendingImages];
      this.pendingImages.clear();
      for (const image of pending) {
        if (!image.isConnected) continue;
        this.processed.delete(image);
        this.queue(image);
      }
    }
  }

  stop(): void {
    this.generation += 1;
    this.mappingPaused = false;
    this.pendingImages.clear();
    this.contexts.clear();
    this.watchedAncestors = new WeakSet<Element>();
    if (this.contextRefresh !== null) clearTimeout(this.contextRefresh);
    this.contextRefresh = null;
    this.rasterAbort.abort();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.rasterWorker.stop();
    this.intersection?.disconnect();
    this.intersection = null;
    this.mutations?.disconnect();
    this.mutations = null;
    document.getElementById(STYLE_ID)?.remove();
    for (const image of this.touched) {
      image.removeAttribute(FILTER_ATTRIBUTE);
      image.removeAttribute(KIND_ATTRIBUTE);
      image.removeAttribute(ACTION_ATTRIBUTE);
      image.removeAttribute(REASON_ATTRIBUTE);
      image.removeAttribute(RASTER_ATTRIBUTE);
      image.removeAttribute(RASTER_TIME_ATTRIBUTE);
      image.removeAttribute(RASTER_MAIN_TIME_ATTRIBUTE);
      image.removeAttribute(RASTER_DISPATCH_TIME_ATTRIBUTE);
      image.removeAttribute(RASTER_WORKER_TIME_ATTRIBUTE);
      image.removeAttribute(RASTER_WORKER_ATTRIBUTE);
    }
    for (const [image, replacement] of this.replacements) {
      restoreAttribute(image, 'src', replacement.src);
      restoreAttribute(image, 'srcset', replacement.srcset);
      restoreAttribute(image, 'sizes', replacement.sizes);
      URL.revokeObjectURL(replacement.objectUrl);
    }
    this.replacements.clear();
    this.touched.clear();
    this.processed = new WeakSet<HTMLImageElement>();
  }

  private scan(root: ParentNode): void {
    if (root instanceof HTMLImageElement) this.queue(root);
    for (const image of root.querySelectorAll<HTMLImageElement>('img')) this.queue(image);
  }

  private queue(image: HTMLImageElement): void {
    if (this.processed.has(image)) return;
    upgradeInsecureMedia(image);
    this.processed.add(image);
    if (this.intersection) this.intersection.observe(image);
    else void this.analyze(image, this.generation);
  }

  private async analyze(image: HTMLImageElement, generation: number): Promise<void> {
    try {
      if (!image.complete) await image.decode();
      if (!this.config.enabled || generation !== this.generation || this.rasterAbort.signal.aborted) return;
      if (image.naturalWidth === 0 || image.naturalHeight === 0) return;
      if (this.mappingPaused) { this.pendingImages.add(image); return; }
      const identity = imageIdentity(image);
      const context = imageContextKey(image);
      const observation = this.withActionHidden(image, () => this.observe(image));
      // Contextual logo decisions must not consume the temporary transparent base.
      if (document.documentElement.hasAttribute('data-semantic-dark-prepaint') &&
          observation.classification.kind === 'icon' && observation.classification.features.transparentRatio > 0.01) {
        this.retryStaleImage(image, generation);
        return;
      }
      const provider = (this.decisionProvider?.requiresOptIn && !this.config.localModel) ||
        this.decisionProvider?.isApplicable?.(observation) === false ? undefined : this.decisionProvider;
      const decision = await decideAsset(observation, provider, this.rasterAbort.signal);
      const current = () => this.config.enabled && !this.mappingPaused && generation === this.generation &&
        image.isConnected && imageIdentity(image) === identity &&
        // The shipped feature router depends on source pixels and configured canvas,
        // not on transient pre-paint colors. Only a contextual provider consumes these.
        ((!provider && decision.authority !== 'constraint') || imageContextKey(image) === context);
      if (!current()) { this.retryStaleImage(image, generation); return; }
      this.apply(image, observation.classification, decision);
      if (observation.classification.kind === 'icon' && observation.classification.features.transparentRatio > 0.01) {
        this.contexts.set(image, imageContextKey(image));
        this.watchAncestors(image);
      }
      if (decision.action === 'diagram') await this.applyRasterDiagram(image, current, generation);
    } catch {
      // Cross-origin/tainted and undecodable resources are intentionally kept.
    }
  }

  /** CSSOM changes use force; ancestor mutations only requeue changed observations. */
  rescan(force = true): void {
    if (!this.config.enabled || this.mappingPaused) return;
    for (const [image, context] of this.contexts) {
      if (!image.isConnected) {
        this.contexts.delete(image); this.processed.delete(image); this.touched.delete(image);
        for (const attribute of [FILTER_ATTRIBUTE, KIND_ATTRIBUTE, ACTION_ATTRIBUTE, REASON_ATTRIBUTE]) image.removeAttribute(attribute);
        continue;
      }
      this.watchAncestors(image);
      if (!force && imageContextKey(image) === context) continue;
      this.contexts.delete(image);
      this.processed.delete(image);
      this.queue(image);
    }
  }

  private scheduleContextRefresh(): void {
    this.contextRefresh ??= setTimeout(() => {
      this.contextRefresh = null;
      this.rescan(false);
    }, 50);
  }

  private watchAncestors(image: HTMLImageElement): void {
    for (let element: Element | null = image; element; element = element.parentElement) {
      if (this.watchedAncestors.has(element)) continue;
      this.watchedAncestors.add(element);
      this.mutations?.observe(element, {attributes: true, attributeFilter: ['class', 'style', 'src', 'srcset', 'sizes']});
    }
  }

  private withActionHidden<T>(image: HTMLImageElement, read: () => T): T {
    if (!image.hasAttribute(FILTER_ATTRIBUTE)) return read();
    image.setAttribute(GUARD_ATTRIBUTE, '');
    void getComputedStyle(image).transitionDuration;
    image.setAttribute(READ_ATTRIBUTE, '');
    try { return read(); }
    finally {
      image.removeAttribute(READ_ATTRIBUTE);
      void getComputedStyle(image).backgroundColor;
      image.removeAttribute(GUARD_ATTRIBUTE);
    }
  }

  private retryStaleImage(image: HTMLImageElement, generation: number): void {
    if (!this.config.enabled || generation !== this.generation || !image.isConnected || this.retryTimers.has(image)) return;
    if (this.mappingPaused) { this.pendingImages.add(image); return; }
    this.retryTimers.set(image, setTimeout(() => {
      this.retryTimers.delete(image);
      if (!this.config.enabled || generation !== this.generation || !image.isConnected) return;
      this.processed.delete(image);
      this.queue(image);
    }, 100));
  }

  private observe(image: HTMLImageElement): AssetObservation {
    const scale = Math.min(1, 128 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('2D canvas unavailable');
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const classification = refineVisualResourceClassification(
      classifyVisualResource(pixels, {maxSamples: 4096}),
      {
        alternativeText: image.alt,
        title: image.title,
        url: image.currentSrc || image.src,
        ...(image.getAttribute('role') == null ? {} : {role: image.getAttribute('role')!}),
      },
    );
    return {
      schema: 'semantic-dark.asset-decision.v1', source: image.currentSrc || image.src,
      pixels, classification, canvasBackground: this.config.background,
      elementBackground: getComputedStyle(image).backgroundColor,
      parentBackground: image.parentElement ? getComputedStyle(image.parentElement).backgroundColor : '',
      simpleBackdrop: classification.kind === 'icon' && hasSimpleImageBackdrop(image),
    };
  }

  private apply(image: HTMLImageElement, classification: VisualResourceClassification, decision: AssetDecision): void {
    image.removeAttribute(FILTER_ATTRIBUTE);
    image.setAttribute(KIND_ATTRIBUTE, `${classification.kind}:${classification.confidence.toFixed(2)}`);
    this.touched.add(image);
    image.setAttribute(REASON_ATTRIBUTE, decision.reason);
    image.setAttribute(ACTION_ATTRIBUTE, `${decision.authority}:${decision.action}`);
    if (decision.action === 'dim' || decision.action === 'monochrome' || decision.action === 'backplate') {
      image.setAttribute(FILTER_ATTRIBUTE, decision.action === 'monochrome' ? 'recolor' : decision.action);
    }
    // Diagrams are deliberately left untouched here. They need palette/region
    // rewriting, not the whole-image filter that caused the original problem.
  }

  private async applyRasterDiagram(image: HTMLImageElement, isCurrent: () => boolean, generation: number): Promise<void> {
    const signal = this.rasterAbort.signal;
    const transformed = await transformDiagramImage(
      image,
      this.config.background,
      this.rasterWorker,
      signal,
    );
    if (signal.aborted) return;
    if (!isCurrent()) { this.retryStaleImage(image, generation); return; }
    if (!transformed) {
      image.setAttribute(RASTER_ATTRIBUTE, 'abstained:pixel-budget');
      return;
    }
    setRasterMetrics(image, transformed);
    if (transformed.failureReason) {
      image.setAttribute(RASTER_ATTRIBUTE, `abstained:${transformed.failureReason}`);
      return;
    }
    if (!transformed.blob || !transformed.report) {
      image.setAttribute(RASTER_ATTRIBUTE, `abstained:${transformed.report?.reason ?? 'unknown'}`);
      return;
    }
    const objectUrl = URL.createObjectURL(transformed.blob);
    this.replacements.set(image, {
      src: image.getAttribute('src'),
      srcset: image.getAttribute('srcset'),
      sizes: image.getAttribute('sizes'),
      objectUrl,
    });
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.setAttribute('src', objectUrl);
    image.setAttribute(RASTER_ATTRIBUTE, 'recolored');
  }
}

function setRasterMetrics(
  image: HTMLImageElement,
  transformed: NonNullable<Awaited<ReturnType<typeof transformDiagramImage>>>,
): void {
  image.setAttribute(RASTER_TIME_ATTRIBUTE, transformed.durationMs.toFixed(1));
  image.setAttribute(RASTER_MAIN_TIME_ATTRIBUTE, transformed.mainThreadDurationMs.toFixed(1));
  image.setAttribute(RASTER_DISPATCH_TIME_ATTRIBUTE, transformed.dispatchDurationMs.toFixed(1));
  image.setAttribute(RASTER_WORKER_TIME_ATTRIBUTE, transformed.workerDurationMs.toFixed(1));
  image.setAttribute(RASTER_WORKER_ATTRIBUTE, transformed.workerMode);
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

// Bind async decisions to the same resource selection and decode dimensions.
function imageIdentity(image: HTMLImageElement): string {
  return JSON.stringify([image.currentSrc, image.getAttribute('src'), image.getAttribute('srcset'),
    image.getAttribute('sizes'), image.naturalWidth, image.naturalHeight]);
}

/** Numeric stroke contrast is valid only without extra compositing in its ancestor chain. */
export function hasSimpleImageBackdrop(image: HTMLImageElement): boolean {
  if (!image.parentElement || parseCssColor(getComputedStyle(image.parentElement).backgroundColor)?.a !== 1) return false;
  for (let element: Element | null = image; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (Number(style.opacity || 1) !== 1 || (style.filter && style.filter !== 'none') ||
        (style.backdropFilter && style.backdropFilter !== 'none') ||
        (style.mixBlendMode && style.mixBlendMode !== 'normal')) return false;
    if ((element === image || element === image.parentElement) && style.backgroundImage && style.backgroundImage !== 'none') return false;
  }
  return true;
}

// Own filter/backplate attributes do not enter this key; it is recorded after paint.
function imageContextKey(image: HTMLImageElement): string {
  const ancestors: string[] = [];
  for (let element: Element | null = image; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    ancestors.push(style.opacity, style.filter, style.backdropFilter, style.mixBlendMode);
  }
  return JSON.stringify([imageIdentity(image), image.className,
    image.style.backgroundColor, image.style.backgroundImage,
    image.style.getPropertyValue('--semantic-dark-background'),
    image.parentElement ? getComputedStyle(image.parentElement).backgroundColor : '', ...ancestors]);
}
