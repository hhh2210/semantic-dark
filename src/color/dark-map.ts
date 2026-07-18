import {
  WCAG_NON_TEXT_CONTRAST,
  WCAG_TEXT_CONTRAST,
  contrastRatio,
  ensureContrastWithReport,
} from './contrast';
import {formatCssColor, parseCssColor} from './css';
import {gamutMapOklch, srgbToOklch} from './oklab';
import {clipSrgb} from './srgb';
import {clamp, srgb, type OklchColor, type SrgbColor} from './types';

export type ColorRole =
  | 'background'
  | 'surface'
  | 'text'
  | 'border'
  | 'accent'
  | 'svgFill'
  | 'svgStroke';

export type SvgColorRole =
  | 'text-fill'
  | 'text-stroke'
  | 'graphic-fill'
  | 'graphic-stroke'
  | 'gradient-stop'
  | 'text-outline'
  | 'graphic';

export type MapColorRole = ColorRole | SvgColorRole;
export type PaintProperty = 'fill' | 'stroke' | 'stop-color';

export interface RoleMapOptions {
  role: MapColorRole;
  against?: SrgbColor;
  preserveHue?: boolean;
  minContrast?: number;
  important?: boolean;
  canvas?: SrgbColor;
  property?: PaintProperty;
}

export interface MapColorOptions {
  role: MapColorRole;
  background?: string;
  preserveHue?: boolean;
  minContrast?: number;
  important?: boolean;
  property?: PaintProperty;
}

export interface RoleMapResult {
  color: SrgbColor;
  role: ColorRole;
  minimumContrast: number;
  achievedContrast: number;
  adjustedForContrast: boolean;
}

export const DEFAULT_DARK_BACKGROUND: Readonly<SrgbColor> = srgb(18 / 255, 18 / 255, 18 / 255);
export const MINIMUM_SURFACE_SEPARATION = 1.12;
const CONSTRAINT_HEADROOM = 0.001;

interface RoleProfile {
  minimumLightness: number;
  lightnessSpan: number;
  chromaScale: number;
}

const ROLE_PROFILES: Readonly<Record<ColorRole, RoleProfile>> = {
  background: {minimumLightness: 0.08, lightnessSpan: 0.14, chromaScale: 0.7},
  surface: {minimumLightness: 0.24, lightnessSpan: 0.16, chromaScale: 0.82},
  text: {minimumLightness: 0.72, lightnessSpan: 0.22, chromaScale: 1},
  border: {minimumLightness: 0.52, lightnessSpan: 0.25, chromaScale: 0.92},
  accent: {minimumLightness: 0.58, lightnessSpan: 0.24, chromaScale: 1},
  svgFill: {minimumLightness: 0.5, lightnessSpan: 0.32, chromaScale: 1},
  svgStroke: {minimumLightness: 0.58, lightnessSpan: 0.3, chromaScale: 1},
};

/** Map a parsed sRGB color into the dark palette with role-specific constraints. */
export function mapRoleColor(color: SrgbColor, options: RoleMapOptions): SrgbColor {
  return mapRoleColorWithReport(color, options).color;
}

export function mapRoleColorWithReport(
  color: SrgbColor,
  options: RoleMapOptions,
): RoleMapResult {
  const role = normalizeRole(options.role, options.property);
  const source = srgbToOklch(clipSrgb(color));
  const profile = ROLE_PROFILES[role];
  const mapped = gamutMapOklch(mapIntoRole(source, profile, options.preserveHue !== false));
  const against = clipSrgb(options.against ?? DEFAULT_DARK_BACKGROUND);
  const minimumContrast = requiredContrast(role, options);

  if (minimumContrast <= 1) {
    return {
      color: mapped,
      role,
      minimumContrast,
      achievedContrast: contrastRatio(mapped, against, options.canvas),
      adjustedForContrast: false,
    };
  }

  const adjustment = ensureContrastWithReport(
    mapped,
    against,
    minimumContrast + CONSTRAINT_HEADROOM,
    {
      direction: role === 'surface' ? 'lighter' : 'auto',
      ...(options.canvas === undefined ? {} : {canvas: options.canvas}),
    },
  );
  return {
    color: adjustment.color,
    role,
    minimumContrast,
    achievedContrast: contrastRatio(adjustment.color, against, options.canvas),
    adjustedForContrast: adjustment.adjusted,
  };
}

/**
 * String wrapper shared by the content DOM engine and SVG transformer. Unknown
 * paints (`none`, `url(...)`, CSS variables) pass through unchanged.
 */
export function mapColor(input: string, options: MapColorOptions): string {
  const source = parseCssColor(input);
  if (!source) return input;
  const background = parseCssColor(options.background ?? '') ?? DEFAULT_DARK_BACKGROUND;
  const mapped = mapRoleColor(source, {
    role: options.role,
    against: background,
    ...(options.preserveHue === undefined ? {} : {preserveHue: options.preserveHue}),
    ...(options.minContrast === undefined ? {} : {minContrast: options.minContrast}),
    ...(options.important === undefined ? {} : {important: options.important}),
    ...(options.property === undefined ? {} : {property: options.property}),
  });
  return formatCssColor(mapped);
}

function mapIntoRole(source: OklchColor, profile: RoleProfile, preserveHue: boolean): OklchColor {
  return {
    l: profile.minimumLightness + profile.lightnessSpan * (1 - clamp(source.l, 0, 1)),
    c: source.c * profile.chromaScale * (preserveHue ? 1 : 0.7),
    h: source.h,
    alpha: source.alpha,
  };
}

function requiredContrast(role: ColorRole, options: RoleMapOptions): number {
  if (options.minContrast !== undefined) return Math.max(1, options.minContrast);
  if (role === 'text') return WCAG_TEXT_CONTRAST;
  if (role === 'surface') return MINIMUM_SURFACE_SEPARATION;
  if (role === 'background' || options.important === false) return 1;
  return WCAG_NON_TEXT_CONTRAST;
}

function normalizeRole(role: MapColorRole, property?: PaintProperty): ColorRole {
  switch (role) {
    case 'text-fill':
      return 'text';
    case 'text-stroke':
    case 'text-outline':
      return 'svgStroke';
    case 'graphic-fill':
      return 'svgFill';
    case 'graphic-stroke':
      return 'svgStroke';
    case 'graphic':
      return property === 'stroke' ? 'svgStroke' : 'svgFill';
    case 'gradient-stop':
      return 'svgFill';
    default:
      return role;
  }
}
