type SchedulableRoot = Document | ShadowRoot;

const STATE_EVENTS = ['pointerover', 'pointerout', 'focusin', 'focusout'] as const;
const MAX_COMPOSED_PATH_DEPTH = 6;

export class DomStateObserver {
  private readonly pending = new Set<HTMLElement>();
  private frame: number | null = null;

  constructor(
    private readonly root: SchedulableRoot,
    private readonly invalidate: (elements: readonly HTMLElement[]) => void,
  ) {}

  start(): void {
    for (const event of STATE_EVENTS) this.root.addEventListener(event, this.onStateEvent, true);
  }

  stop(): void {
    for (const event of STATE_EVENTS) this.root.removeEventListener(event, this.onStateEvent, true);
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending.clear();
  }

  private readonly onStateEvent = (event: Event): void => {
    let depth = 0;
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      if (node === document.body || node === document.documentElement) break;
      this.pending.add(node);
      depth += 1;
      if (depth >= MAX_COMPOSED_PATH_DEPTH) break;
    }
    if (this.pending.size === 0 || this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const elements = [...this.pending];
      this.pending.clear();
      this.invalidate(elements);
    });
  };
}
