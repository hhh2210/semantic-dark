import {mapColor, mapCssGradient} from '../color/index';
import type {ThemeConfig} from '../types';
import {
  beginDomStyleUpdate,
  DOM_ATTRIBUTE as ATTR,
  DOM_VARIABLE as VAR,
  domOverrideCss,
  endDomStyleUpdate,
} from './dom-style-contract';

type SchedulableRoot = Document | ShadowRoot;

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining(): number;
}

function scheduleIdle(callback: (deadline: IdleDeadlineLike) => void): number {
  if ('requestIdleCallback' in globalThis) {
    return globalThis.requestIdleCallback(callback, {timeout: 120});
  }
  return window.setTimeout(() => callback({didTimeout: true, timeRemaining: () => 0}), 0);
}

function isTransparent(color: string): boolean {
  const normalized = color.replaceAll(' ', '').toLowerCase();
  return normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized.endsWith(',0)') ||
    normalized.endsWith('/0)') ||
    normalized.endsWith('/0%)');
}

function shouldSkip(element: Element): boolean {
  return element instanceof SVGElement ||
    element instanceof HTMLStyleElement ||
    element instanceof HTMLScriptElement ||
    element instanceof HTMLLinkElement ||
    element instanceof HTMLMetaElement ||
    element instanceof HTMLHeadElement;
}

function ownsRenderedText(element: HTMLElement): boolean {
  if (element.matches('input, textarea, select, option, button')) return true;
  return [...element.childNodes].some((node) =>
    node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0
  );
}

function hasVisibleBorder(style: CSSStyleDeclaration): boolean {
  return ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
    const width = Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
    const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
    return width > 0 && kind !== 'none' && kind !== 'hidden';
  });
}

function inheritedMappedBackground(element: HTMLElement, fallback: string): string {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const mapped = current.style.getPropertyValue(VAR.background);
    if (mapped) return mapped;
    current = current.parentElement;
  }
  return fallback;
}

function ensureOverrideStyle(root: SchedulableRoot): void {
  if (root.querySelector('style[data-semantic-dark-sheet]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-semantic-dark-sheet', '');
  style.textContent = domOverrideCss(root instanceof Document);
  if (root instanceof Document) (root.head ?? root.documentElement).append(style);
  else root.append(style);
}

function removeOverrideStyle(root: SchedulableRoot): void {
  root.querySelector('style[data-semantic-dark-sheet]')?.remove();
}

export class DomThemeEngine {
  private config: ThemeConfig;
  private readonly roots = new Set<SchedulableRoot>();
  private readonly observers = new Map<SchedulableRoot, MutationObserver>();
  private readonly touched = new Set<HTMLElement>();
  private queue: Element[] = [];
  private queued = new WeakSet<Element>();
  private idleHandle: number | null = null;
  private enabled = false;

  constructor(config: ThemeConfig) {
    this.config = config;
  }

  start(root: Document = document): void {
    this.enabled = this.config.enabled;
    if (!this.enabled) return;
    this.registerRoot(root);
  }

  update(config: ThemeConfig): void {
    const wasEnabled = this.enabled;
    this.config = config;
    this.enabled = config.enabled;
    if (!this.enabled) {
      this.stop();
      return;
    }
    if (!wasEnabled) this.registerRoot(document);
    this.resetTouchedElements();
    this.enqueue(document.documentElement);
  }

  stop(): void {
    this.enabled = false;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const root of this.roots) removeOverrideStyle(root);
    this.roots.clear();
    this.queue = [];
    this.queued = new WeakSet<Element>();
    for (const element of this.touched) this.restoreElement(element);
    this.touched.clear();
  }

  rescan(): void {
    if (!this.enabled) return;
    this.resetTouchedElements();
    this.enqueue(document.documentElement);
  }

  private registerRoot(root: SchedulableRoot): void {
    if (this.roots.has(root)) return;
    this.roots.add(root);
    ensureOverrideStyle(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const target = record.target as Element;
          if (target instanceof HTMLElement) {
            this.restoreElement(target);
            this.touched.delete(target);
          }
          this.enqueue(target);
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element && !node.hasAttribute('data-semantic-dark-sheet')) this.enqueue(node);
        }
      }
    });
    observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'color', 'bgcolor']});
    this.observers.set(root, observer);
    if (root instanceof Document) this.enqueue(root.documentElement);
    else for (const child of root.children) this.enqueue(child);
  }

  private enqueue(root: Element): void {
    if (!this.enabled || this.queued.has(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current: Node | null = root;
    while (current) {
      const element = current as Element;
      if (!this.queued.has(element)) {
        this.queued.add(element);
        this.queue.push(element);
      }
      current = walker.nextNode();
    }
    if (this.idleHandle == null) this.idleHandle = scheduleIdle((deadline) => this.drain(deadline));
  }

  private drain(deadline: IdleDeadlineLike): void {
    this.idleHandle = null;
    let processed = 0;
    while (this.queue.length > 0 && (processed < 80 || deadline.timeRemaining() > 2)) {
      const element = this.queue.shift()!;
      this.queued.delete(element);
      this.processElement(element);
      processed += 1;
    }
    if (this.queue.length > 0) this.idleHandle = scheduleIdle((next) => this.drain(next));
  }

  private processElement(element: Element): void {
    if (shouldSkip(element)) return;
    if (element.shadowRoot) this.registerRoot(element.shadowRoot);
    if (!(element instanceof HTMLElement)) return;

    beginDomStyleUpdate(element);
    try {
      this.mapElement(element);
    } finally {
      endDomStyleUpdate(element);
    }
  }

  private mapElement(element: HTMLElement): void {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const canvasElement = element === document.documentElement || element === document.body;
    const background = isTransparent(style.backgroundColor)
      ? inheritedMappedBackground(element, this.config.background)
      : canvasElement
        ? this.config.background
        : mapColor(style.backgroundColor, {role: 'surface', background: this.config.background});
    const gradient = mapCssGradient(style.backgroundImage, this.config.background);

    if (!isTransparent(style.backgroundColor)) {
      element.style.setProperty(VAR.background, background);
      element.setAttribute(ATTR.background, '');
    }
    if (gradient) {
      element.style.setProperty(VAR.backgroundImage, gradient.css);
      element.setAttribute(ATTR.backgroundImage, '');
    }

    const readabilityBackground = gradient?.readabilityBackground ?? background;

    const parentColor = element.parentElement?.hasAttribute(ATTR.color)
      ? getComputedStyle(element.parentElement).color
      : null;
    const inheritsMappedColor = parentColor != null && parentColor === style.color;
    if (ownsRenderedText(element) && !inheritsMappedColor && !isTransparent(style.color)) {
      element.style.setProperty(VAR.color, mapColor(style.color, {
        role: 'text',
        background: readabilityBackground,
        minContrast: this.config.minimumTextContrast,
        preserveHue: true,
      }));
      element.setAttribute(ATTR.color, '');
    }

    if (hasVisibleBorder(style)) {
      for (const [side, variable] of [
        ['top', VAR.borderTop], ['right', VAR.borderRight],
        ['bottom', VAR.borderBottom], ['left', VAR.borderLeft],
      ] as const) {
        element.style.setProperty(variable, mapColor(style.getPropertyValue(`border-${side}-color`), {
          role: 'border', background: readabilityBackground, minContrast: 3, preserveHue: true,
        }));
      }
      element.setAttribute(ATTR.border, '');
    }

    if (style.textDecorationLine !== 'none' || style.caretColor !== 'auto') {
      element.style.setProperty(VAR.decoration, mapColor(style.textDecorationColor, {
        role: 'accent', background: readabilityBackground, minContrast: 3, preserveHue: true,
      }));
      element.style.setProperty(VAR.caret, mapColor(style.caretColor === 'auto' ? style.color : style.caretColor, {
        role: 'text', background: readabilityBackground,
        minContrast: this.config.minimumTextContrast, preserveHue: true,
      }));
      element.setAttribute(ATTR.decoration, '');
    }
    this.touched.add(element);
  }

  private restoreElement(element: HTMLElement): void {
    for (const attribute of Object.values(ATTR)) element.removeAttribute(attribute);
    for (const variable of Object.values(VAR)) element.style.removeProperty(variable);
  }

  private resetTouchedElements(): void {
    for (const element of this.touched) this.restoreElement(element);
    this.touched.clear();
  }
}
