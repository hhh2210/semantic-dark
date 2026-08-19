import {
  matchOfficialThemeSite,
  type OfficialThemeMutation,
  type OfficialThemeSite,
  type OfficialThemeTarget,
} from './official-theme-catalog';
import {
  darkClassForLightClass,
  darkValueForThemeToken,
  THEME_ATTRIBUTES,
} from './theme-markers';

export interface OfficialThemeProbe {
  capable: boolean;
  source: 'none' | 'catalog' | 'theme-attribute' | 'theme-class' | 'catalog+generic';
  catalogId: string | null;
  recipes: OfficialThemeMutation[];
}

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

interface OfficialThemeSession {
  html: RootSnapshot;
  body: RootSnapshot | null;
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
    this.session = {
      html: snapshotRoot(html, htmlAttributes),
      body: body ? snapshotRoot(body, bodyAttributes) : null,
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
    this.session = null;
  }

  isApplied(): boolean {
    return this.session !== null;
  }
}

export function probeOfficialTheme(root: Document, host: string): OfficialThemeProbe {
  const site = matchOfficialThemeSite(host);
  const generic = genericRecipes(root);
  const recipes = dedupeRecipes([...(site?.mutations ?? []), ...generic]);
  return {
    capable: recipes.length > 0,
    source: probeSource(site, generic),
    catalogId: site?.id ?? null,
    recipes,
  };
}

function probeSource(
  site: OfficialThemeSite | null,
  generic: readonly OfficialThemeMutation[],
): OfficialThemeProbe['source'] {
  if (site && generic.length > 0) return 'catalog+generic';
  if (site) return 'catalog';
  if (generic.some((recipe) => recipe.type === 'attribute')) return 'theme-attribute';
  if (generic.length > 0) return 'theme-class';
  return 'none';
}

function genericRecipes(root: Document): OfficialThemeMutation[] {
  const recipes: OfficialThemeMutation[] = [];
  for (const target of ['html', 'body'] as const) {
    const element = targetElement(root, target);
    if (!element) continue;
    for (const name of THEME_ATTRIBUTES) {
      const current = element.getAttribute(name);
      if (!current) continue;
      const dark = darkValueForThemeToken(current);
      if (dark && dark !== current) {
        recipes.push({type: 'attribute', target, name, value: dark});
      }
    }
    const remove: string[] = [];
    const add: string[] = [];
    for (const token of [...element.classList]) {
      const dark = darkClassForLightClass(token);
      if (!dark) continue;
      remove.push(token);
      add.push(dark);
    }
    if (add.length > 0) recipes.push({type: 'class', target, add, remove});
  }
  return recipes;
}

function dedupeRecipes(recipes: readonly OfficialThemeMutation[]): OfficialThemeMutation[] {
  const seen = new Set<string>();
  const unique: OfficialThemeMutation[] = [];
  for (const recipe of recipes) {
    const key = recipeKey(recipe);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(recipe);
  }
  return unique;
}

function recipeKey(recipe: OfficialThemeMutation): string {
  if (recipe.type === 'attribute') return `attr:${recipe.target}:${recipe.name}:${recipe.value}`;
  return `class:${recipe.target}:${[...recipe.add].sort().join(',')}:${[...(recipe.remove ?? [])].sort().join(',')}`;
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
  const element = targetElement(root, recipe.target);
  if (!element) return;
  if (recipe.type === 'attribute') {
    element.setAttribute(recipe.name, recipe.value);
    return;
  }
  if (recipe.remove) element.classList.remove(...recipe.remove);
  element.classList.add(...recipe.add);
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
