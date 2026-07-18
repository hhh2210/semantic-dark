import type {ThemeConfig} from '../types';
import {
  beginDomStyleUpdate,
  domOverrideCss,
  endDomStyleUpdate,
} from './dom-style-contract';
import {DomStateObserver} from './dom-state-observer';
import {mapElementStyles, restoreElementStyles} from './dom-style-mapper';

type SchedulableRoot = Document | ShadowRoot;
const MAX_INTERACTION_ELEMENTS = 64;
const MAX_INTERACTION_CHILDREN = 24;

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

function shouldSkip(element: Element): boolean {
  return element instanceof SVGElement ||
    element instanceof HTMLStyleElement ||
    element instanceof HTMLScriptElement ||
    element instanceof HTMLLinkElement ||
    element instanceof HTMLMetaElement ||
    element instanceof HTMLHeadElement;
}

function composedElementDepth(element: HTMLElement): number {
  let current: Element | null = element;
  let depth = 0;
  while (current) {
    depth += 1;
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return depth;
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
  private readonly stateObservers = new Map<SchedulableRoot, DomStateObserver>();
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
    for (const observer of this.stateObservers.values()) observer.stop();
    this.stateObservers.clear();
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
    const stateObserver = new DomStateObserver(root, (elements) => this.invalidateStates(elements));
    stateObserver.start();
    this.stateObservers.set(root, stateObserver);
    if (root instanceof Document) this.enqueue(root.documentElement);
    else for (const child of root.children) this.enqueue(child);
  }

  private enqueue(root: Element): void {
    if (!this.enabled) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current: Node | null = root;
    while (current) {
      const element = current as Element;
      this.enqueueOne(element);
      current = walker.nextNode();
    }
    if (this.idleHandle == null) this.idleHandle = scheduleIdle((deadline) => this.drain(deadline));
  }

  private enqueueOne(element: Element): void {
    if (this.queued.has(element)) return;
    this.queued.add(element);
    this.queue.push(element);
  }

  private drain(deadline: IdleDeadlineLike): void {
    this.idleHandle = null;
    let processed = 0;
    while (this.queue.length > 0 && (processed < 80 || deadline.timeRemaining() > 2)) {
      const element = this.queue.shift()!;
      if (!this.queued.has(element)) continue;
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
      if (mapElementStyles(element, this.config)) this.touched.add(element);
    } finally {
      endDomStyleUpdate(element);
    }
  }

  private invalidateStates(elements: readonly HTMLElement[]): void {
    if (!this.enabled) return;
    const path = elements.filter((element) => element.isConnected)
      .slice(0, MAX_INTERACTION_ELEMENTS);
    const affected = new Set(path);
    for (const element of path) {
      if (element.children.length > MAX_INTERACTION_CHILDREN) continue;
      for (const child of element.children) {
        if (affected.size >= MAX_INTERACTION_ELEMENTS) break;
        if (child instanceof HTMLElement) affected.add(child);
      }
      if (affected.size >= MAX_INTERACTION_ELEMENTS) break;
    }
    const ordered = [...affected].sort((first, second) =>
      composedElementDepth(first) - composedElementDepth(second)
    );
    for (const element of ordered) this.queued.delete(element);
    for (const element of ordered) {
      restoreElementStyles(element);
      this.touched.delete(element);
      this.processElement(element);
    }
  }

  private restoreElement(element: HTMLElement): void {
    restoreElementStyles(element);
  }

  private resetTouchedElements(): void {
    for (const element of this.touched) this.restoreElement(element);
    this.touched.clear();
  }
}
