/**
 * Tiny seed of sites whose official dark mode is preferable to Semantic Dark.
 * This is not a CSS patch database: recipes only flip documented root markers.
 */

export type OfficialThemeTarget = 'html' | 'body';

export type OfficialThemeMutation =
  | {type: 'attribute'; target: OfficialThemeTarget; name: string; value: string}
  | {type: 'class'; target: OfficialThemeTarget; add: readonly string[]; remove?: readonly string[]};

export interface OfficialThemeSite {
  id: string;
  hostSuffixes: readonly string[];
  mutations: readonly OfficialThemeMutation[];
}

export const OFFICIAL_THEME_SEED: readonly OfficialThemeSite[] = [
  {
    id: 'zhihu',
    hostSuffixes: ['zhihu.com'],
    mutations: [
      {type: 'attribute', target: 'html', name: 'data-theme', value: 'dark'},
    ],
  },
  {
    id: 'bilibili',
    hostSuffixes: ['bilibili.com'],
    mutations: [
      {type: 'class', target: 'html', add: ['dark']},
      {type: 'class', target: 'body', add: ['dark']},
    ],
  },
];

export function normalizeHostname(host: string): string {
  const [hostname = ''] = host.trim().toLowerCase().split(':');
  return hostname.replace(/\.$/, '');
}

export function matchOfficialThemeSite(
  host: string,
  catalog: readonly OfficialThemeSite[] = OFFICIAL_THEME_SEED,
): OfficialThemeSite | null {
  const hostname = normalizeHostname(host);
  if (!hostname) return null;
  return catalog.find((site) => site.hostSuffixes.some((suffix) => hostnameMatches(hostname, suffix)))
    ?? null;
}

function hostnameMatches(hostname: string, suffix: string): boolean {
  const needle = normalizeHostname(suffix);
  return hostname === needle || hostname.endsWith(`.${needle}`);
}
