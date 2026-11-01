import type {ThemeConfig} from '../types';
import {
  beginDomStyleUpdate,
  domOverrideCss,
  endDomStyleUpdate,
  needsTransitionGuard,
  withPrepaintExempt,
} from './dom-style-contract';
import {DomStateObserver} from './dom-state-observer';
import {mapElementStyles, restoreElementStyles} from './dom-style-mapper';

type SchedulableRoot = Document | ShadowRoot;
const MAX_INTERACTION_ELEMENTS = 64;
const MAX_INTERACTION_CHILDREN = 24;
// Mutation callbacks run before the next paint. Mapping a bounded prefix there
// keeps inserted or restyled content from painting its light authored colors.
// Right after a discrete input the user is waiting for that frame anyway, so a
// one-frame budget is preferable to a flash; ambient mutation streams (timers,
// animations, live data) keep the smaller budget so they cannot cause jank.
const MUTATION_SYNC_BUDGET_MS = 8;
const INTERACTION_SYNC_BUDGET_MS = 16;
const INTERACTION_WINDOW_MS = 1000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'click'] as const;
// Remapping an already-mapped container restyles its whole subtree (its color
// is inherited). Such containers keep their previous dark mapping until idle.
const SYNC_REMAP_SUBTREE_LIMIT = 512;
const IDLE_BATCH_SIZE = 40;

function hasAncestorIn(element: Element, set: ReadonlySet<Element>): boolean {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (set.has(parent)) return true;
  }
  return false;
}

function collectSubtree(root: Element, out: Element[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let current: Node | null = root; current; current = walker.nextNode()) out.push(current as Element);
}

function hasLargeSubtree(element: Element): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  for (let count = 0; walker.nextNode(); count += 1) {
    if (count >= SYNC_REMAP_SUBTREE_LIMIT) return true;
  }
  return false;
}

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
  private frameHandle: number | null = null;
  // Elements of recently changed subtrees, in tree order, mapped before paint.
  private urgent: Element[] = [];
  private urgentIndex = 0;
  private idleWaiters: Array<() => void> = [];
  private enabled = false;
  private lastInput = Number.NEGATIVE_INFINITY;
  private readonly onInput = (): void => {
    this.lastInput = performance.now();
  };

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
    // Each element keeps its previous mapping until it is atomically remapped.
    this.enqueue(document.documentElement);
  }

  /** Resolves once every queued element is mapped, or at once if none is pending. */
  whenIdle(): Promise<void> {
    if (!this.enabled || this.idleHandle == null) return Promise.resolve();
    return new Promise((resolve) => { this.idleWaiters.push(resolve); });
  }

  stop(): void {
    this.enabled = false;
    for (const event of INPUT_EVENTS) window.removeEventListener(event, this.onInput, true);
    this.lastInput = Number.NEGATIVE_INFINITY;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const observer of this.stateObservers.values()) observer.stop();
    this.stateObservers.clear();
    for (const root of this.roots) removeOverrideStyle(root);
    this.roots.clear();
    if (this.frameHandle != null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.urgent = [];
    this.urgentIndex = 0;
    this.queue = [];
    this.queued = new WeakSet<Element>();
    for (const element of this.touched) this.restoreElement(element);
    this.touched.clear();
    this.resolveIdleWaiters();
  }

  rescan(): void {
    if (!this.enabled) return;
    this.pruneDetached();
    // Restoring everything first would paint the light page until idle remapping
    // catches up. Stale dark mappings are replaced element by element instead.
    this.enqueue(document.documentElement);
  }

  private registerRoot(root: SchedulableRoot): void {
    if (this.roots.has(root)) return;
    this.roots.add(root);
    ensureOverrideStyle(root);
    if (root instanceof Document) {
      for (const event of INPUT_EVENTS) {
        window.addEventListener(event, this.onInput, {capture: true, passive: true});
      }
    }
    const observer = new MutationObserver((records) => {
      const changed = new Set<Element>();
      for (const record of records) {
        if (record.type === 'attributes') changed.add(record.target as Element);
        for (const node of record.addedNodes) {
          if (node instanceof Element && !node.hasAttribute('data-semantic-dark-sheet')) changed.add(node);
        }
      }
      for (const element of changed) {
        if (!hasAncestorIn(element, changed)) this.enqueue(element, this.urgent);
      }
      const now = performance.now();
      const budget = now - this.lastInput < INTERACTION_WINDOW_MS
        ? INTERACTION_SYNC_BUDGET_MS
        : MUTATION_SYNC_BUDGET_MS;
      this.drainUrgent(now + budget);
    });
    observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'color', 'bgcolor']});
    this.observers.set(root, observer);
    const stateObserver = new DomStateObserver(root, (elements) => this.invalidateStates(elements));
    stateObserver.start();
    this.stateObservers.set(root, stateObserver);
    if (root instanceof Document) this.enqueue(root.documentElement);
    else for (const child of root.children) this.enqueue(child);
  }

  private enqueue(root: Element, urgent?: Element[]): void {
    if (!this.enabled) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current: Node | null = root;
    while (current) {
      const element = current as Element;
      this.enqueueOne(element);
      urgent?.push(element);
      current = walker.nextNode();
    }
    if (this.idleHandle == null) this.idleHandle = scheduleIdle((deadline) => this.drain(deadline));
  }

  private enqueueOne(element: Element): void {
    if (this.queued.has(element)) return;
    this.queued.add(element);
    this.queue.push(element);
  }

  // Changed subtrees are mapped before paint until the deadline, then once per
  // frame before paint, so an unfinished remainder is light for frames rather
  // than an idle period. The cursor only moves forward, so every frame makes
  // progress and the list empties.
  private drainUrgent(deadline: number): void {
    while (this.urgentIndex < this.urgent.length) {
      if (!this.enabled) return;
      if (performance.now() >= deadline) {
        this.frameHandle ??= requestAnimationFrame(() => {
          this.frameHandle = null;
          this.drainUrgent(performance.now() + MUTATION_SYNC_BUDGET_MS);
        });
        return;
      }
      const element = this.urgent[this.urgentIndex]!;
      this.urgentIndex += 1;
      if (!this.queued.has(element) || !element.isConnected) continue;
      // Already-mapped large containers keep their dark mapping until idle time.
      if (element instanceof HTMLElement && this.touched.has(element) && hasLargeSubtree(element)) continue;
      this.queued.delete(element);
      this.processElement(element);
      if (element.shadowRoot) {
        for (const child of element.shadowRoot.children) collectSubtree(child, this.urgent);
      }
    }
    this.urgent = [];
    this.urgentIndex = 0;
  }

  private drain(deadline: IdleDeadlineLike): void {
    this.idleHandle = null;
    let processed = 0;
    const timeoutBudget = deadline.didTimeout ? 240 : 80;
    while (this.queue.length > 0 && (processed < timeoutBudget || deadline.timeRemaining() > 2)) {
      const batch: Element[] = [];
      while (this.queue.length > 0 && batch.length < IDLE_BATCH_SIZE) {
        const element = this.queue.shift()!;
        if (!this.queued.has(element)) continue;
        this.queued.delete(element);
        batch.push(element);
      }
      this.processBatch(batch);
      processed += batch.length;
    }
    if (this.queue.length > 0) this.idleHandle = scheduleIdle((next) => this.drain(next));
    else {
      this.pruneDetached();
      this.resolveIdleWaiters();
    }
  }

  // Removed content must not stay referenced (and restored on stop) forever.
  private pruneDetached(): void {
    for (const element of this.touched) {
      if (!element.isConnected) this.touched.delete(element);
    }
  }

  private resolveIdleWaiters(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private processElement(element: Element): void {
    this.processBatch([element]);
  }

  // Restores and remaps a tree-ordered batch within one task: authored sources
  // must be read without our override, but nothing is painted in between.
  // Restoring the whole batch first costs one style invalidation instead of one
  // per element. Restoring also clears the transition guard's marker, so it
  // comes first. The rest of the batch cannot animate, so the pre-paint's
  // exemption needs no guard of its own.
  private processBatch(elements: readonly Element[]): void {
    const batch: HTMLElement[] = [];
    for (const element of elements) {
      if (shouldSkip(element)) continue;
      if (element.shadowRoot) this.registerRoot(element.shadowRoot);
      if (element instanceof HTMLElement) batch.push(element);
    }
    const guarded = batch.filter(needsTransitionGuard);
    for (const element of batch) restoreElementStyles(element);
    for (const element of guarded) beginDomStyleUpdate(element);
    try {
      withPrepaintExempt(batch, () => {
        for (const element of batch) {
          if (mapElementStyles(element, this.config)) this.touched.add(element);
          else this.touched.delete(element);
        }
      });
    } finally {
      for (const element of guarded) endDomStyleUpdate(element);
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
    for (const element of ordered) this.processElement(element);
  }

  private restoreElement(element: HTMLElement): void {
    restoreElementStyles(element);
  }
}
