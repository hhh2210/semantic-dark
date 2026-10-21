import {isStylesheetLink, probeOfficialTheme, type OfficialThemeProbe, type OfficialThemeRecipe} from './official-theme-recipes';

export {
  officialThemeLooksApplied,
  probeOfficialTheme,
  type OfficialThemeProbe,
  type OfficialThemeSource,
} from './official-theme-recipes';

export interface OfficialThemeLaneLike {
  probe(): OfficialThemeProbe;
  activate(): boolean;
  settle?(signal: AbortSignal): Promise<void>;
  restore(): void;
  isApplied(): boolean;
}

export interface OfficialThemeLaneOptions {
  document?: Document;
  hostname?: () => string;
}

interface OfficialThemeSession {
  undo: Array<() => void>;
  stylesheets: HTMLLinkElement[];
}

export class OfficialThemeLane implements OfficialThemeLaneLike {
  private session: OfficialThemeSession | null = null;
  private readonly documentRef: Document;
  private readonly hostname: () => string;

  constructor(options: OfficialThemeLaneOptions = {}) {
    this.documentRef = options.document ?? document;
    this.hostname = options.hostname ?? currentHostname;
  }

  probe(): OfficialThemeProbe {
    return probeOfficialTheme(this.documentRef, this.hostname());
  }

  activate(): boolean {
    this.restore();
    const probe = this.probe();
    if (probe.recipes.length === 0) return false;
    const session: OfficialThemeSession = {undo: [], stylesheets: []};
    this.session = session;
    for (const recipe of probe.recipes) this.applyMutation(recipe, session);
    return true;
  }

  async settle(signal: AbortSignal): Promise<void> {
    await Promise.all(this.session?.stylesheets.map((link) => waitForStylesheet(link, signal)) ?? []);
  }

  restore(): void {
    const session = this.session;
    this.session = null;
    // Reverse overlapping catalog/generic edits, on the original nodes only.
    for (const undo of session?.undo.reverse() ?? []) undo();
  }

  isApplied(): boolean {
    return this.session !== null;
  }

  private applyMutation(recipe: OfficialThemeRecipe, session: OfficialThemeSession): void {
    if (recipe.type === 'stylesheet') {
      const {link} = recipe;
      if (!link.isConnected || link.ownerDocument !== this.documentRef || !isStylesheetLink(link)) return;
      const href = link.getAttribute('href');
      const title = link.title;
      const disabled = link.disabled;
      const media = link.getAttribute('media');
      const rel = link.rel;
      const type = link.type;
      session.undo.push(() => {
        // A replaced or repurposed resource belongs to the site now.
        if (link.getAttribute('href') !== href || link.title !== title ||
          link.rel !== rel || link.type !== type) return;
        if (disabled !== recipe.disabled && link.disabled === recipe.disabled) link.disabled = disabled;
        if (media !== recipe.media && link.getAttribute('media') === recipe.media) {
          restoreAttribute(link, 'media', media);
        }
      });
      link.disabled = recipe.disabled;
      link.media = recipe.media;
      session.stylesheets.push(link);
      return;
    }
    const element = recipe.target === 'html' ? this.documentRef.documentElement : this.documentRef.body;
    if (!element) return;
    if (recipe.type === 'attribute') {
      const before = element.getAttribute(recipe.name);
      if (before === recipe.value) return;
      session.undo.push(() => {
        if (element.getAttribute(recipe.name) === recipe.value) restoreAttribute(element, recipe.name, before);
      });
      element.setAttribute(recipe.name, recipe.value);
      return;
    }
    const added = recipe.add.filter((token) => !element.classList.contains(token));
    const removed = (recipe.remove ?? []).filter((token) => element.classList.contains(token));
    if (added.length === 0 && removed.length === 0) return;
    const hadClass = element.hasAttribute('class');
    session.undo.push(() => {
      // Remove only our additions. If the site replaced the dark tokens, do
      // not resurrect the old light tokens into its new theme.
      const intact = recipe.add.every((token) => element.classList.contains(token));
      element.classList.remove(...added);
      if (intact) element.classList.add(...removed);
      if (!hadClass && element.getAttribute('class') === '') element.removeAttribute('class');
    });
    element.classList.remove(...removed);
    element.classList.add(...added);
  }
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function waitForStylesheet(link: HTMLLinkElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted || link.sheet || !link.isConnected) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      link.removeEventListener('load', finish);
      link.removeEventListener('error', finish);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    // Bound failed/hung loads; visual confirmation still decides whether to keep it.
    const timer = setTimeout(finish, 2000);
    link.addEventListener('load', finish, {once: true});
    link.addEventListener('error', finish, {once: true});
    signal.addEventListener('abort', finish, {once: true});
  });
}

function currentHostname(): string {
  try {
    return location.hostname;
  } catch {
    return '';
  }
}
