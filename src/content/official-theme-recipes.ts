import type {NativeThemeDecision} from './native-theme-evidence';
import {
  matchOfficialThemeSite,
  type OfficialThemeMutation,
  type OfficialThemeSite,
} from './official-theme-catalog';
import {
  BOOLEAN_DARK_ATTRIBUTES,
  darkBooleanValueFor,
  darkClassForLightClass,
  darkValueForThemeToken,
  THEME_ATTRIBUTES,
} from './theme-markers';

export type OfficialThemeSource =
  | 'none'
  | 'catalog'
  | 'theme-attribute'
  | 'theme-class'
  | 'stylesheet'
  | 'catalog+generic'
  | 'mixed';

export interface OfficialThemeProbe {
  capable: boolean;
  source: OfficialThemeSource;
  catalogId: string | null;
  recipes: OfficialThemeMutation[];
}

const DARK_STYLESHEET_TITLE = /\b(dark|night|black|nocturne)\b/i;

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

/** Official success needs visual dark, not only a marker we just wrote. */
export function officialThemeLooksApplied(decision: NativeThemeDecision): boolean {
  if (decision.kind !== 'native-dark') return false;
  const evidence = decision.evidence;
  if (decision.reason === 'dark-rendered-surfaces') return true;
  if (decision.reason === 'dark-color-scheme-without-light-conflict') return true;
  if (evidence.knownSamples >= 4 && evidence.darkCoverage >= 0.65 && evidence.lightCoverage <= 0.3) {
    return true;
  }
  if (evidence.knownSamples >= 3 && evidence.darkCoverage >= 0.5 && !evidence.lightCanvas) {
    return true;
  }
  return false;
}

export function genericRecipes(root: Document): OfficialThemeMutation[] {
  return [
    ...rootAttributeRecipes(root),
    ...stylesheetRecipes(root),
  ];
}

function rootAttributeRecipes(root: Document): OfficialThemeMutation[] {
  const recipes: OfficialThemeMutation[] = [];
  for (const target of ['html', 'body'] as const) {
    const element = target === 'html' ? root.documentElement : root.body;
    if (!element) continue;
    for (const name of THEME_ATTRIBUTES) {
      const current = element.getAttribute(name);
      if (!current) continue;
      const dark = darkValueForThemeToken(current);
      if (dark && dark !== current) {
        recipes.push({type: 'attribute', target, name, value: dark});
      }
    }
    for (const name of BOOLEAN_DARK_ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      const dark = darkBooleanValueFor(element.getAttribute(name));
      if (dark) recipes.push({type: 'attribute', target, name, value: dark});
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

function stylesheetRecipes(root: Document): OfficialThemeMutation[] {
  const recipes: OfficialThemeMutation[] = [];
  for (const node of root.querySelectorAll('link')) {
    if (!(node instanceof HTMLLinkElement)) continue;
    if (!isStylesheetLink(node)) continue;
    if (!isDarkStylesheetCandidate(node)) continue;
    recipes.push({
      type: 'stylesheet',
      href: node.getAttribute('href') ?? '',
      title: node.title,
      disabled: false,
      media: enabledStylesheetMedia(node.media),
    });
  }
  return recipes;
}

function isStylesheetLink(link: HTMLLinkElement): boolean {
  const rel = link.rel.toLowerCase();
  return rel.split(/\s+/).includes('stylesheet') || rel.split(/\s+/).includes('alternate');
}

function isDarkStylesheetCandidate(link: HTMLLinkElement): boolean {
  const title = link.title.trim();
  const media = link.media.trim().toLowerCase();
  const darkTitle = title.length > 0 && DARK_STYLESHEET_TITLE.test(title);
  const darkMedia = /prefers-color-scheme:\s*dark/.test(media);
  if (!darkTitle && !darkMedia) return false;
  const alternate = link.rel.toLowerCase().split(/\s+/).includes('alternate');
  const inertMedia = media === 'none' || media === 'not all';
  return link.disabled || alternate || inertMedia;
}

function enabledStylesheetMedia(media: string): string {
  const value = media.trim().toLowerCase();
  if (value === '' || value === 'none' || value === 'not all') return 'all';
  return media;
}

function probeSource(
  site: OfficialThemeSite | null,
  generic: readonly OfficialThemeMutation[],
): OfficialThemeSource {
  if (site && generic.length > 0) return 'catalog+generic';
  if (site) return 'catalog';
  const kinds = new Set(generic.map((recipe) => recipe.type));
  if (kinds.size > 1) return 'mixed';
  if (kinds.has('stylesheet')) return 'stylesheet';
  if (kinds.has('class')) return 'theme-class';
  if (kinds.has('attribute')) return 'theme-attribute';
  return 'none';
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
  if (recipe.type === 'stylesheet') {
    return `css:${recipe.href}:${recipe.title}:${recipe.disabled}:${recipe.media}`;
  }
  return `class:${recipe.target}:${[...recipe.add].sort().join(',')}:${[...(recipe.remove ?? [])].sort().join(',')}`;
}
