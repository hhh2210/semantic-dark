import {
  type OfficialThemeMutation,
  type OfficialThemeTarget,
} from './official-theme-catalog';
import {
  probeOfficialTheme,
  type OfficialThemeProbe,
} from './official-theme-recipes';

export {
  officialThemeLooksApplied,
  probeOfficialTheme,
  type OfficialThemeProbe,
  type OfficialThemeSource,
} from './official-theme-recipes';

export interface OfficialThemeLaneLike {
  probe(): OfficialThemeProbe;
  activate(): boolean;
  restore(): void;
  isApplied(): boolean;
}

export interface OfficialThemeLaneOptions {
  document?: Document;
  hostname?: () => string;
}

interface RootSnapshot {
  className: string;
  attributes: Array<{name: string; value: string | null}>;
}

interface StylesheetSnapshot {
  href: string;
  title: string;
  disabled: boolean;
  media: string;
}

interface OfficialThemeSession {
  html: RootSnapshot;
  body: RootSnapshot | null;
  stylesheets: StylesheetSnapshot[];
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
    const html = this.documentRef.documentElement;
    const body = this.documentRef.body;
    const htmlAttributes = attributeNames(probe.recipes, 'html');
    const bodyAttributes = attributeNames(probe.recipes, 'body');
    const stylesheetTargets = stylesheetRecipes(probe.recipes)
      .map((recipe) => snapshotStylesheet(this.documentRef, recipe))
      .filter((snapshot): snapshot is StylesheetSnapshot => snapshot !== null);
    this.session = {
      html: snapshotRoot(html, htmlAttributes),
      body: body ? snapshotRoot(body, bodyAttributes) : null,
      stylesheets: stylesheetTargets,
    };
    for (const recipe of probe.recipes) applyMutation(this.documentRef, recipe);
    return true;
  }

  restore(): void {
    if (!this.session) return;
    restoreRoot(this.documentRef.documentElement, this.session.html);
    if (this.session.body && this.documentRef.body) {
      restoreRoot(this.documentRef.body, this.session.body);
    }
    for (const snapshot of this.session.stylesheets) restoreStylesheet(this.documentRef, snapshot);
    this.session = null;
  }

  isApplied(): boolean {
    return this.session !== null;
  }
}

function attributeNames(
  recipes: readonly OfficialThemeMutation[],
  target: OfficialThemeTarget,
): string[] {
  return [...new Set(
    recipes
      .filter((recipe): recipe is Extract<OfficialThemeMutation, {type: 'attribute'}> =>
        recipe.type === 'attribute' && recipe.target === target)
      .map((recipe) => recipe.name),
  )];
}

function stylesheetRecipes(
  recipes: readonly OfficialThemeMutation[],
): Array<Extract<OfficialThemeMutation, {type: 'stylesheet'}>> {
  return recipes.filter((recipe): recipe is Extract<OfficialThemeMutation, {type: 'stylesheet'}> =>
    recipe.type === 'stylesheet');
}

function snapshotRoot(element: Element, attributeNamesToStore: readonly string[]): RootSnapshot {
  return {
    className: classNameOf(element),
    attributes: attributeNamesToStore.map((name) => ({name, value: element.getAttribute(name)})),
  };
}

function restoreRoot(element: Element, snapshot: RootSnapshot): void {
  element.setAttribute('class', snapshot.className);
  if (!snapshot.className) element.removeAttribute('class');
  for (const {name, value} of snapshot.attributes) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}

function applyMutation(root: Document, recipe: OfficialThemeMutation): void {
  if (recipe.type === 'stylesheet') {
    const link = findStylesheet(root, recipe.href, recipe.title);
    if (!link) return;
    link.disabled = recipe.disabled;
    link.media = recipe.media;
    return;
  }
  const element = targetElement(root, recipe.target);
  if (!element) return;
  if (recipe.type === 'attribute') {
    element.setAttribute(recipe.name, recipe.value);
    return;
  }
  if (recipe.remove) element.classList.remove(...recipe.remove);
  element.classList.add(...recipe.add);
}

function snapshotStylesheet(
  root: Document,
  recipe: Extract<OfficialThemeMutation, {type: 'stylesheet'}>,
): StylesheetSnapshot | null {
  const link = findStylesheet(root, recipe.href, recipe.title);
  if (!link) return null;
  return {
    href: recipe.href,
    title: recipe.title,
    disabled: link.disabled,
    media: link.media,
  };
}

function restoreStylesheet(root: Document, snapshot: StylesheetSnapshot): void {
  const link = findStylesheet(root, snapshot.href, snapshot.title);
  if (!link) return;
  link.disabled = snapshot.disabled;
  link.media = snapshot.media;
}

function findStylesheet(root: Document, href: string, title: string): HTMLLinkElement | null {
  const links = [...root.querySelectorAll('link')].filter((node): node is HTMLLinkElement =>
    node instanceof HTMLLinkElement);
  if (href) {
    const match = links.find((link) => link.getAttribute('href') === href);
    if (match) return match;
  }
  if (title) return links.find((link) => link.title === title) ?? null;
  return null;
}

function targetElement(root: Document, target: OfficialThemeTarget): Element | null {
  return target === 'html' ? root.documentElement : root.body;
}

function classNameOf(element: Element): string {
  const {className} = element;
  return typeof className === 'string' ? className : element.getAttribute('class') ?? '';
}

function currentHostname(): string {
  try {
    return location.hostname;
  } catch {
    return '';
  }
}
