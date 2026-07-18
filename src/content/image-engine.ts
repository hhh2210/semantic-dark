import {
  classifyVisualResource,
  refineVisualResourceClassification,
  type VisualResourceClassification,
} from '../vision/index';
import type {ThemeConfig} from '../types';
import {transformDiagramImage} from './raster-image';
import {RasterWorkerClient} from './raster-worker-client';

const FILTER_ATTRIBUTE = 'data-semantic-dark-image-filter';
const KIND_ATTRIBUTE = 'data-semantic-dark-image-kind';
const RASTER_ATTRIBUTE = 'data-semantic-dark-raster-status';
const RASTER_TIME_ATTRIBUTE = 'data-semantic-dark-raster-ms';
const RASTER_MAIN_TIME_ATTRIBUTE = 'data-semantic-dark-raster-main-ms';
const RASTER_DISPATCH_TIME_ATTRIBUTE = 'data-semantic-dark-raster-dispatch-ms';
const RASTER_WORKER_TIME_ATTRIBUTE = 'data-semantic-dark-raster-worker-ms';
const RASTER_WORKER_ATTRIBUTE = 'data-semantic-dark-raster-worker';
const STYLE_ID = 'semantic-dark-image-sheet';
const IMAGE_STYLE = `
img[${FILTER_ATTRIBUTE}="dim"] { filter: brightness(.82) contrast(1.04) !important; }
img[${FILTER_ATTRIBUTE}="recolor"] { filter: brightness(0) invert(.92) !important; }
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
  private intersection: IntersectionObserver | null = null;
  private mutations: MutationObserver | null = null;

  constructor(config: ThemeConfig) {
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
    const paletteChanged = config.background !== this.config.background;
    this.config = config;
    if (!config.enabled) this.stop();
    else if (!wasEnabled) this.start();
    else if (paletteChanged) {
      this.stop();
      this.start();
    }
  }

  stop(): void {
    this.generation += 1;
    this.rasterAbort.abort();
    this.rasterWorker.stop();
    this.intersection?.disconnect();
    this.intersection = null;
    this.mutations?.disconnect();
    this.mutations = null;
    document.getElementById(STYLE_ID)?.remove();
    for (const image of this.touched) {
      image.removeAttribute(FILTER_ATTRIBUTE);
      image.removeAttribute(KIND_ATTRIBUTE);
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
    this.processed.add(image);
    if (this.intersection) this.intersection.observe(image);
    else void this.analyze(image, this.generation);
  }

  private async analyze(image: HTMLImageElement, generation: number): Promise<void> {
    try {
      if (!image.complete) await image.decode();
      if (!this.config.enabled || generation !== this.generation || this.rasterAbort.signal.aborted) return;
      if (image.naturalWidth === 0 || image.naturalHeight === 0) return;
      const classification = this.classify(image);
      if (!this.config.enabled || generation !== this.generation) return;
      this.apply(image, classification);
      if (classification.kind === 'diagram' && classification.confidence >= 0.58) {
        await this.applyRasterDiagram(image);
      }
    } catch {
      // Cross-origin/tainted and undecodable resources are intentionally kept.
    }
  }

  private classify(image: HTMLImageElement): VisualResourceClassification {
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
    return refineVisualResourceClassification(
      classifyVisualResource(pixels, {maxSamples: 4096}),
      {
        alternativeText: image.alt,
        title: image.title,
        url: image.currentSrc || image.src,
        ...(image.getAttribute('role') == null ? {} : {role: image.getAttribute('role')!}),
      },
    );
  }

  private apply(image: HTMLImageElement, classification: VisualResourceClassification): void {
    image.setAttribute(KIND_ATTRIBUTE, `${classification.kind}:${classification.confidence.toFixed(2)}`);
    this.touched.add(image);
    if (classification.confidence < 0.58) return;
    if (classification.policy === 'dim' || classification.policy === 'recolor') {
      image.setAttribute(FILTER_ATTRIBUTE, classification.policy);
    }
    // Diagrams are deliberately left untouched here. They need palette/region
    // rewriting, not the whole-image filter that caused the original problem.
  }

  private async applyRasterDiagram(image: HTMLImageElement): Promise<void> {
    const signal = this.rasterAbort.signal;
    const transformed = await transformDiagramImage(
      image,
      this.config.background,
      this.rasterWorker,
      signal,
    );
    if (signal.aborted || !this.config.enabled) return;
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
