export type ThemeMode = 'auto' | 'on' | 'off';

export interface ThemeConfig {
  /** Compatibility projection for the current popup and legacy stored values. */
  enabled: boolean;
  mode?: ThemeMode;
  background: string;
  minimumTextContrast: number;
}

export interface NormalizedThemeConfig extends ThemeConfig {
  mode: ThemeMode;
}

export const DEFAULT_THEME: NormalizedThemeConfig = {
  enabled: true,
  mode: 'auto',
  background: '#111416',
  minimumTextContrast: 4.5,
};

export function normalizeThemeConfig(
  input?: Partial<ThemeConfig> | null,
): NormalizedThemeConfig {
  const mode = isThemeMode(input?.mode)
    ? input.mode
    : input?.enabled === false ? 'off' : 'auto';
  return {
    enabled: mode !== 'off',
    mode,
    background: typeof input?.background === 'string'
      ? input.background
      : DEFAULT_THEME.background,
    minimumTextContrast: typeof input?.minimumTextContrast === 'number' &&
      Number.isFinite(input.minimumTextContrast)
      ? input.minimumTextContrast
      : DEFAULT_THEME.minimumTextContrast,
  };
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'auto' || value === 'on' || value === 'off';
}

export type PageThemeDecision =
  | 'pending'
  | 'system-light'
  | 'applied-light'
  | 'native-dark'
  | 'ambiguous'
  | 'forced-colors'
  | 'user-on'
  | 'user-off';

export interface PageThemeStatus {
  mode: ThemeMode;
  effectiveEnabled: boolean;
  decision: PageThemeDecision;
  reason: string;
}

export type RuntimeMessage =
  | {type: 'semantic-dark:get-config'; host: string}
  | {type: 'semantic-dark:set-config'; host: string; config: ThemeConfig}
  | {type: 'semantic-dark:config-changed'; host: string; config: ThemeConfig}
  | {type: 'semantic-dark:get-status'; host: string};
