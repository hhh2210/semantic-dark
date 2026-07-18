import {mapColor, mapCssGradient} from '../color/index';
import type {ThemeConfig} from '../types';
import {DOM_ATTRIBUTE as ATTR, DOM_VARIABLE as VAR} from './dom-style-contract';

type PseudoKind = 'before' | 'after';
type BorderSide = 'top' | 'right' | 'bottom' | 'left';

interface PaintSnapshot {
  display: string;
  visibility: string;
  content: string;
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  textDecorationLine: string;
  textDecorationColor: string;
  caretColor: string;
  border: Record<BorderSide, {color: string; style: string; width: number}>;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const SUPPORTS_PSEUDO_STYLES = typeof CSS !== 'undefined' &&
  CSS.supports('selector(::before)');

function snapshot(style: CSSStyleDeclaration): PaintSnapshot {
  return {
    display: style.display,
    visibility: style.visibility,
    content: style.content,
    color: style.color,
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    textDecorationLine: style.textDecorationLine,
    textDecorationColor: style.textDecorationColor,
    caretColor: style.caretColor,
    border: Object.fromEntries(SIDES.map((side) => [side, {
      color: style.getPropertyValue(`border-${side}-color`),
      style: style.getPropertyValue(`border-${side}-style`),
      width: Number.parseFloat(style.getPropertyValue(`border-${side}-width`)),
    }])) as PaintSnapshot['border'],
  };
}

function pseudoSnapshot(element: HTMLElement, pseudo: '::before' | '::after'): PaintSnapshot | null {
  if (!SUPPORTS_PSEUDO_STYLES) return null;
  const style = getComputedStyle(element, pseudo);
  if (style.display === 'none' || style.visibility === 'hidden' ||
      style.content === 'none' || style.content === 'normal') return null;
  return snapshot(style);
}

function isTransparent(color: string): boolean {
  const normalized = color.replaceAll(' ', '').toLowerCase();
  return normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized.endsWith(',0)') ||
    normalized.endsWith('/0)') ||
    normalized.endsWith('/0%)');
}

function ownsRenderedText(element: HTMLElement): boolean {
  if (element.matches('input, textarea, select, option, button')) return true;
  return [...element.childNodes].some((node) =>
    node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0
  );
}

function hasVisibleBorder(style: PaintSnapshot): boolean {
  return SIDES.some((side) => {
    const border = style.border[side];
    return border.width > 0 && border.style !== 'none' && border.style !== 'hidden';
  });
}

function mappedBackground(element: HTMLElement | null, fallback: string): string {
  let current = element;
  while (current) {
    const mapped = current.style.getPropertyValue(VAR.background);
    if (mapped) return mapped;
    current = current.parentElement;
  }
  return fallback;
}

function mapBorder(
  element: HTMLElement,
  style: PaintSnapshot,
  attribute: string,
  variables: Record<BorderSide, string>,
  background: string,
): boolean {
  if (!hasVisibleBorder(style)) return false;
  for (const side of SIDES) {
    element.style.setProperty(variables[side], mapColor(style.border[side].color, {
      role: 'border', background, minContrast: 3, preserveHue: true,
    }));
  }
  element.setAttribute(attribute, '');
  return true;
}

function pseudoExists(style: PaintSnapshot): boolean {
  return style.display !== 'none' && style.visibility !== 'hidden' &&
    style.content !== 'none' && style.content !== 'normal';
}

function pseudoHasText(content: string): boolean {
  const normalized = content.trim();
  return normalized !== '""' && normalized !== "''";
}

function mapPseudo(
  element: HTMLElement,
  kind: PseudoKind,
  style: PaintSnapshot,
  config: ThemeConfig,
  hostColor: string,
  hostColorIsMapped: boolean,
): boolean {
  if (!pseudoExists(style)) return false;
  const prefix = kind === 'before' ? 'before' : 'after';
  const background = isTransparent(style.backgroundColor)
    ? mappedBackground(element, config.background)
    : mapColor(style.backgroundColor, {role: 'surface', background: config.background});
  const gradient = mapCssGradient(style.backgroundImage, config.background);
  let touched = false;

  if (!isTransparent(style.backgroundColor)) {
    element.style.setProperty(VAR[`${prefix}Background`], background);
    element.setAttribute(ATTR[`${prefix}Background`], '');
    touched = true;
  }
  if (gradient) {
    element.style.setProperty(VAR[`${prefix}BackgroundImage`], gradient.css);
    element.setAttribute(ATTR[`${prefix}BackgroundImage`], '');
    touched = true;
  }

  const readabilityBackground = gradient?.readabilityBackground ?? background;
  const inheritsMappedHostColor = hostColorIsMapped && style.color === hostColor &&
    getComputedStyle(element, `::${kind}`).color === getComputedStyle(element).color;
  if (pseudoHasText(style.content) && !inheritsMappedHostColor && !isTransparent(style.color)) {
    element.style.setProperty(VAR[`${prefix}Color`], mapColor(style.color, {
      role: 'text', background: readabilityBackground,
      minContrast: config.minimumTextContrast, preserveHue: true,
    }));
    element.setAttribute(ATTR[`${prefix}Color`], '');
    touched = true;
  }

  const borderVariables = Object.fromEntries(SIDES.map((side) => [
    side,
    VAR[`${prefix}Border${side.charAt(0).toUpperCase()}${side.slice(1)}` as
      `${PseudoKind}Border${Capitalize<BorderSide>}`],
  ])) as Record<BorderSide, string>;
  return mapBorder(
    element,
    style,
    ATTR[`${prefix}Border`],
    borderVariables,
    readabilityBackground,
  ) || touched;
}

export function mapElementStyles(element: HTMLElement, config: ThemeConfig): boolean {
  const style = snapshot(getComputedStyle(element));
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const before = pseudoSnapshot(element, '::before');
  const after = pseudoSnapshot(element, '::after');
  const canvasElement = element === document.documentElement || element === document.body;
  const background = isTransparent(style.backgroundColor)
    ? mappedBackground(element.parentElement, config.background)
    : canvasElement
      ? config.background
      : mapColor(style.backgroundColor, {role: 'surface', background: config.background});
  const gradient = mapCssGradient(style.backgroundImage, config.background);
  let touched = false;

  if (!isTransparent(style.backgroundColor)) {
    element.style.setProperty(VAR.background, background);
    element.setAttribute(ATTR.background, '');
    touched = true;
  }
  if (gradient) {
    element.style.setProperty(VAR.backgroundImage, gradient.css);
    element.setAttribute(ATTR.backgroundImage, '');
    touched = true;
  }

  const readabilityBackground = gradient?.readabilityBackground ?? background;
  const parentColor = element.parentElement?.hasAttribute(ATTR.color)
    ? getComputedStyle(element.parentElement).color
    : null;
  const inheritsMappedColor = parentColor != null && parentColor === style.color;
  const mapsOwnColor = ownsRenderedText(element) &&
    !inheritsMappedColor && !isTransparent(style.color);
  if (mapsOwnColor) {
    element.style.setProperty(VAR.color, mapColor(style.color, {
      role: 'text', background: readabilityBackground,
      minContrast: config.minimumTextContrast, preserveHue: true,
    }));
    element.setAttribute(ATTR.color, '');
    touched = true;
  }

  touched = mapBorder(element, style, ATTR.border, {
    top: VAR.borderTop,
    right: VAR.borderRight,
    bottom: VAR.borderBottom,
    left: VAR.borderLeft,
  }, readabilityBackground) || touched;

  if (style.textDecorationLine !== 'none' || style.caretColor !== 'auto') {
    element.style.setProperty(VAR.decoration, mapColor(style.textDecorationColor, {
      role: 'accent', background: readabilityBackground, minContrast: 3, preserveHue: true,
    }));
    element.style.setProperty(VAR.caret, mapColor(
      style.caretColor === 'auto' ? style.color : style.caretColor,
      {role: 'text', background: readabilityBackground,
        minContrast: config.minimumTextContrast, preserveHue: true},
    ));
    element.setAttribute(ATTR.decoration, '');
    touched = true;
  }

  const hostColorIsMapped = mapsOwnColor || inheritsMappedColor;
  const beforeTouched = before != null &&
    mapPseudo(element, 'before', before, config, style.color, hostColorIsMapped);
  const afterTouched = after != null &&
    mapPseudo(element, 'after', after, config, style.color, hostColorIsMapped);
  return beforeTouched || afterTouched || touched;
}

export function restoreElementStyles(element: HTMLElement): void {
  for (const attribute of Object.values(ATTR)) element.removeAttribute(attribute);
  for (const variable of Object.values(VAR)) element.style.removeProperty(variable);
}
