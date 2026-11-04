import {mapColor, mapCssGradient, parseCssColor, formatRgba8CssColor} from '../color/index';
import {darkenGradientForText, type GradientMapResult} from '../color/gradient';
import {textColorForBackdrops} from '../color/text-contrast';
import type {ThemeConfig} from '../types';
import {ACTIVE_ATTRIBUTE, DOM_ATTRIBUTE as ATTR, DOM_VARIABLE as VAR} from './dom-style-contract';

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
// Authored backgrounds recorded when an element was last mapped. Remapping
// happens in place, so while an override is in effect this is the only way to
// read the authored value; it can be stale until the element is remapped.
const mappedBackdrops = new WeakMap<Element, readonly string[]>();
const authoredBackgrounds = new WeakMap<Element, string>();

export function authoredBackgroundColor(element: Element): string {
  const recorded = authoredBackgrounds.get(element);
  // Shadow-root overrides are not scoped to the document marker.
  const overridden = recorded !== undefined && (element.getRootNode() instanceof ShadowRoot ||
    document.documentElement.hasAttribute(ACTIVE_ATTRIBUTE));
  return overridden ? recorded : getComputedStyle(element).backgroundColor;
}

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
  if (color.trim().toLowerCase() === 'transparent') return true;
  const parsed = parseCssColor(color);
  return parsed !== null && parsed.a <= 1e-6;
}

function ownsRenderedText(element: HTMLElement): boolean {
  if (element.matches('input, textarea, select, option, button')) return true;
  if ([...element.childNodes].some((node) =>
    node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0
  )) return true;
  // Containers can paint inherited text through nested spans/strong/links. Mapping
  // only direct text nodes leaves the container's own text color black after its
  // background is converted to dark. Descendants are processed afterwards and
  // can override this inherited fallback with their own mapped/accent colors.
  return element.childElementCount > 0 &&
    (element.textContent?.trim().length ?? 0) > 0;
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

function inheritedBackdrops(element: HTMLElement | null, fallback: string): readonly string[] {
  for (let current = element; current; current = current.parentElement) {
    const known = mappedBackdrops.get(current);
    if (known) return known;
  }
  return [fallback];
}

function hasMappedTextAncestor(element: HTMLElement): boolean {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.hasAttribute(ATTR.color)) return true;
  }
  return false;
}

function normalizedColor(value: string): string {
  const parsed = parseCssColor(value);
  return parsed ? formatRgba8CssColor(parsed) : value;
}

function readableText(color: string, alreadyMapped: boolean, backdrops: readonly string[],
  gradient: GradientMapResult | null, config: ThemeConfig) {
  const mapped = alreadyMapped ? color : mapColor(color, {role: 'text', minContrast: 1});
  const foreground = parseCssColor(mapped);
  if (!foreground) return {color: mapped, gradient};
  const solve = (values: readonly string[]) => textColorForBackdrops(foreground,
    values.map(value => parseCssColor(value)!).filter(Boolean), config.minimumTextContrast);
  let repaired = solve(backdrops);
  if (!repaired && gradient) {
    gradient = darkenGradientForText(gradient, config.minimumTextContrast);
    repaired = solve(gradient.readabilityBackgrounds);
  }
  return {color: formatRgba8CssColor(repaired ?? foreground), gradient};
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
  let gradient = mapCssGradient(style.backgroundImage, background);
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

  const inheritsMappedHostColor = hostColorIsMapped && style.color === hostColor &&
    getComputedStyle(element, `::${kind}`).color === getComputedStyle(element).color;
  if (pseudoHasText(style.content) && !isTransparent(style.color)) {
    const foreground = inheritsMappedHostColor ? getComputedStyle(element).color : style.color;
    const backdrops = gradient?.readabilityBackgrounds ?? (isTransparent(style.backgroundColor)
      ? inheritedBackdrops(element, background) : [background]);
    const readable = readableText(foreground, inheritsMappedHostColor, backdrops, gradient, config);
    if (!inheritsMappedHostColor || readable.color !== normalizedColor(foreground)) {
      element.style.setProperty(VAR[`${prefix}Color`], readable.color);
      element.setAttribute(ATTR[`${prefix}Color`], '');
      touched = true;
    }
    gradient = readable.gradient;
    if (gradient) element.style.setProperty(VAR[`${prefix}BackgroundImage`], gradient.css);
  }
  const readabilityBackground = gradient?.readabilityBackground ?? background;

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
  let gradient = mapCssGradient(style.backgroundImage, background);
  let touched = false;

  if (!isTransparent(style.backgroundColor)) {
    element.style.setProperty(VAR.background, background);
    element.setAttribute(ATTR.background, '');
    authoredBackgrounds.set(element, style.backgroundColor);
    touched = true;
  }
  if (gradient) {
    element.style.setProperty(VAR.backgroundImage, gradient.css);
    element.setAttribute(ATTR.backgroundImage, '');
    touched = true;
  }

  const parentColor = element.parentElement && hasMappedTextAncestor(element)
    ? getComputedStyle(element.parentElement).color : null;
  const inheritsMappedColor = parentColor != null && parentColor === style.color;
  let mapsOwnColor = false;
  let backdrops = gradient?.readabilityBackgrounds ?? (isTransparent(style.backgroundColor)
    ? inheritedBackdrops(element.parentElement, background) : [background]);
  if (ownsRenderedText(element) && !isTransparent(style.color)) {
    const readable = readableText(style.color, inheritsMappedColor, backdrops, gradient, config);
    mapsOwnColor = !inheritsMappedColor || readable.color !== normalizedColor(style.color);
    if (mapsOwnColor) {
      element.style.setProperty(VAR.color, readable.color);
      element.setAttribute(ATTR.color, '');
      touched = true;
    }
    gradient = readable.gradient;
    if (gradient) {
      element.style.setProperty(VAR.backgroundImage, gradient.css);
      backdrops = gradient.readabilityBackgrounds;
    }
  }
  mappedBackdrops.set(element, backdrops);
  const readabilityBackground = gradient?.readabilityBackground ?? background;

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
  authoredBackgrounds.delete(element);
  mappedBackdrops.delete(element);
  for (const attribute of Object.values(ATTR)) element.removeAttribute(attribute);
  for (const variable of Object.values(VAR)) element.style.removeProperty(variable);
}
