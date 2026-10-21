import {BOOLEAN_DARK_ATTRIBUTES, THEME_ATTRIBUTES} from './theme-markers';

const ROOT_THEME_ATTRIBUTES = ['class', 'style', ...THEME_ATTRIBUTES, ...BOOLEAN_DARK_ATTRIBUTES] as const;
const HEAD_THEME_ATTRIBUTES = [
  'class', 'content', 'disabled', 'href', 'media', 'name', 'rel', 'style', 'title', 'type',
] as const;
const THEME_NODE_SELECTOR = [
  'style:not([data-semantic-dark-sheet])',
  'link[rel~="stylesheet" i]',
  'meta[name="color-scheme" i]',
].join(',');

/** Watches only authored signals capable of changing the page color scheme. */
export class AuthoredThemeObserver {
  private observer: MutationObserver | null = null;
  private observedRoot: HTMLElement | null = null;
  private observedHead: HTMLHeadElement | null = null;
  private observedBody: HTMLElement | null = null;
  private suspensionDepth = 0;

  constructor(private readonly onChange: () => void) {}

  private readonly notifyForLoadedStyle = (event: Event): void => {
    if (this.suspensionDepth > 0 || !this.observer) return;
    if (!(event.target instanceof HTMLLinkElement || event.target instanceof HTMLStyleElement)) return;
    if (!event.target.matches(THEME_NODE_SELECTOR) ||
      event.target.matches('[data-semantic-dark-sheet]')) return;
    this.onChange();
  };

  start(): void {
    this.stop();
    this.observer = new MutationObserver((records) => {
      this.observeThemeContainers();
      if (records.some(isAuthoredThemeMutation)) this.onChange();
    });
    this.observer.observe(document, {childList: true, subtree: true});
    this.observeThemeContainers();
    document.addEventListener('load', this.notifyForLoadedStyle, true);
  }

  stop(): void {
    this.suspensionDepth = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoot = null;
    this.observedHead = null;
    this.observedBody = null;
    document.removeEventListener('load', this.notifyForLoadedStyle, true);
  }

  suspend(): void {
    if (!this.observer || this.suspensionDepth++ > 0) return;
    this.observer.takeRecords();
    this.observer.disconnect();
    this.observedRoot = null;
    this.observedHead = null;
    this.observedBody = null;
  }

  resume(): void {
    if (!this.observer || this.suspensionDepth === 0 || --this.suspensionDepth > 0) return;
    this.observer.observe(document, {childList: true, subtree: true});
    this.observeThemeContainers();
  }

  private observeThemeContainers(): void {
    if (!this.observer) return;
    const root = document.documentElement;
    if (root && root !== this.observedRoot) {
      this.observer.observe(root, {
        attributes: true,
        attributeFilter: [...ROOT_THEME_ATTRIBUTES],
        attributeOldValue: true,
      });
      this.observedRoot = root;
    }
    if (document.head && document.head !== this.observedHead) {
      this.observer.observe(document.head, {
        attributes: true,
        attributeFilter: [...HEAD_THEME_ATTRIBUTES],
        attributeOldValue: true,
        characterData: true,
        subtree: true,
      });
      this.observedHead = document.head;
    }
    if (document.body && document.body !== this.observedBody) {
      this.observer.observe(document.body, {
        attributes: true,
        attributeFilter: [...ROOT_THEME_ATTRIBUTES],
        attributeOldValue: true,
      });
      this.observedBody = document.body;
    }
  }
}

function isAuthoredThemeMutation(record: MutationRecord): boolean {
  if (record.type === 'characterData') {
    const style = record.target.parentElement?.closest('style');
    return style != null && !style.hasAttribute('data-semantic-dark-sheet');
  }
  if (record.type === 'attributes') {
    if (record.target instanceof Element &&
      record.target.closest('[data-semantic-dark-sheet],[data-semantic-dark-ui]')) return false;
    if (record.attributeName?.startsWith('data-semantic-dark-')) return false;
    if (record.attributeName === 'style' && record.target instanceof Element &&
      authoredInlineStyle(record.oldValue ?? '') ===
        authoredInlineStyle(record.target.getAttribute('style') ?? '')) return false;
    if (record.target === document.documentElement || record.target === document.body) return true;
    if (record.target === document.head) return true;
    if (record.target instanceof HTMLLinkElement && record.attributeName === 'rel' &&
      (record.oldValue ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) return true;
    return record.target instanceof Element && record.target.matches(THEME_NODE_SELECTOR);
  }
  return [...record.addedNodes, ...record.removedNodes].some(isThemeNode);
}

function isThemeNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element || element.closest('[data-semantic-dark-sheet],[data-semantic-dark-ui]')) return false;
  return element.matches('html,head,body') || element.matches(THEME_NODE_SELECTOR) ||
    element.querySelector(THEME_NODE_SELECTOR) !== null;
}

function authoredInlineStyle(value: string): string {
  return value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !declaration.startsWith('--semantic-dark-'))
    .sort()
    .join(';');
}
