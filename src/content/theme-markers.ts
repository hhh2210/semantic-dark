/** Root markers used by native-dark detection and official-theme activation. */

export const DARK_CLASSES = ['dark', 'dark-mode', 'theme-dark', 'is-dark'] as const;
export const LIGHT_CLASSES = ['light', 'light-mode', 'theme-light', 'is-light'] as const;

export const THEME_ATTRIBUTES = [
  'data-theme',
  'data-bs-theme',
  'data-color-mode',
  'data-color-theme',
  'data-mode',
  'data-dark-mode',
] as const;

const LIGHT_TO_DARK_VALUE: Record<string, string> = {
  light: 'dark',
  day: 'night',
  'light-mode': 'dark-mode',
  'theme-light': 'theme-dark',
};

const LIGHT_TO_DARK_CLASS: Record<string, string> = {
  light: 'dark',
  'light-mode': 'dark-mode',
  'theme-light': 'theme-dark',
  'is-light': 'is-dark',
};

export function isDarkClassToken(token: string): boolean {
  return (DARK_CLASSES as readonly string[]).includes(token.toLowerCase());
}

export function darkValueForThemeToken(value: string): string | null {
  return LIGHT_TO_DARK_VALUE[value.trim().toLowerCase()] ?? null;
}

export function darkClassForLightClass(token: string): string | null {
  return LIGHT_TO_DARK_CLASS[token.toLowerCase()] ?? null;
}
