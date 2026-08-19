/** Root markers used by native-dark detection and official-theme activation. */

export const DARK_CLASSES = [
  'dark', 'dark-mode', 'dark-theme', 'theme-dark', 'is-dark', 'night', 'night-mode',
] as const;
export const LIGHT_CLASSES = [
  'light', 'light-mode', 'light-theme', 'theme-light', 'is-light', 'day', 'day-mode',
] as const;

export const THEME_ATTRIBUTES = [
  'data-theme',
  'data-bs-theme',
  'data-color-mode',
  'data-color-theme',
  'data-mode',
  'data-dark-mode',
  'data-theme-mode',
  'theme',
  'lab-style',
] as const;

export const BOOLEAN_DARK_ATTRIBUTES = [
  'dark',
  'data-dark',
  'data-dark-mode',
  'darkmode',
] as const;

const LIGHT_TO_DARK_VALUE: Record<string, string> = {
  light: 'dark',
  day: 'night',
  auto: 'dark',
  system: 'dark',
  'light-mode': 'dark-mode',
  'theme-light': 'theme-dark',
};

const LIGHT_TO_DARK_CLASS: Record<string, string> = {
  light: 'dark',
  'light-mode': 'dark-mode',
  'light-theme': 'dark-theme',
  'theme-light': 'theme-dark',
  'is-light': 'is-dark',
  day: 'night',
  'day-mode': 'night-mode',
};

const LIGHT_BOOLEAN_VALUES = new Set(['false', '0', 'no', 'off']);

export function isDarkClassToken(token: string): boolean {
  return (DARK_CLASSES as readonly string[]).includes(token.toLowerCase());
}

export function darkValueForThemeToken(value: string): string | null {
  return LIGHT_TO_DARK_VALUE[value.trim().toLowerCase()] ?? null;
}

export function darkClassForLightClass(token: string): string | null {
  return LIGHT_TO_DARK_CLASS[token.toLowerCase()] ?? null;
}

export function darkBooleanValueFor(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return null;
  }
  if (LIGHT_BOOLEAN_VALUES.has(normalized)) return 'true';
  return null;
}
