import {relativeLuminance, type SrgbColor} from '../color/index';


export const DARK_LUMINANCE = 0.18;
export const LIGHT_LUMINANCE = 0.55;

export type NativeThemeKind = 'native-dark' | 'light' | 'ambiguous' | 'forced-colors';

export interface NativeThemeEvidence {
  forcedColors: boolean;
  negotiatedDark: boolean;
  declaredLight: boolean;
  lightCanvas: boolean;
  visibleContent: boolean;
  rootDarkMarker: boolean;
  knownSamples: number;
  darkCoverage: number;
  lightCoverage: number;
  lightOnDarkCoherence: number;
  darkOnLightCoherence: number;
}

export interface NativeThemeDecision {
  kind: NativeThemeKind;
  reason: string;
  evidence: NativeThemeEvidence;
}

export interface ViewportOverlayGeometry {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  position: string;
  zIndex: string;
  role: string | null;
  tagName: string;
}

export function classifyNativeTheme(evidence: NativeThemeEvidence): NativeThemeDecision {
  const strongDark = evidence.knownSamples >= 5 && (
    (evidence.darkCoverage >= 0.65 && evidence.lightOnDarkCoherence >= 0.55) ||
    evidence.darkCoverage >= 0.78
  );
  const strongLight = evidence.visibleContent && evidence.knownSamples >= 4 &&
    evidence.lightCoverage >= 0.7 &&
    evidence.darkCoverage <= 0.2 &&
    evidence.darkOnLightCoherence >= 0.55;
  const explicitLight = evidence.visibleContent && evidence.declaredLight && evidence.lightCanvas &&
    !evidence.negotiatedDark && !evidence.rootDarkMarker &&
    (evidence.knownSamples === 0 || (
      evidence.lightCoverage >= 0.5 && evidence.darkCoverage < 0.4
    ));
  const implicitLight = evidence.visibleContent && evidence.lightCanvas &&
    !evidence.negotiatedDark && !evidence.rootDarkMarker &&
    evidence.knownSamples >= 2 &&
    evidence.lightCoverage >= 0.5 &&
    evidence.darkCoverage < 0.35;

  if (evidence.forcedColors) return decision('forced-colors', 'forced-colors-active', evidence);
  if (strongDark) return decision('native-dark', 'dark-rendered-surfaces', evidence);
  if (evidence.rootDarkMarker) {
    return strongLight
      ? decision('ambiguous', 'dark-marker-conflicts-with-light-rendering', evidence)
      : decision('native-dark', 'active-root-dark-marker', evidence);
  }
  if (evidence.negotiatedDark && !strongLight && (
    evidence.darkCoverage >= 0.4 || evidence.knownSamples === 0
  )) {
    return decision('native-dark', 'dark-color-scheme-without-light-conflict', evidence);
  }
  if (strongLight) return decision('light', 'light-rendered-surfaces', evidence);
  if (explicitLight) return decision('light', 'explicit-light-scheme', evidence);
  if (implicitLight) return decision('light', 'light-canvas-without-dark-conflict', evidence);
  return decision('ambiguous', 'insufficient-stable-theme-evidence', evidence);
}

/** Bitmap/url backgrounds are uninterpretable; CSS gradients remain sampleable. */
export function backgroundImageBlocksSample(backgroundImage: string): boolean {
  return /url\(/i.test(backgroundImage);
}

/**
 * Opaque html/body paint wins. A fully transparent root inherits the UA canvas,
 * which is light unless the page already negotiated a dark color-scheme.
 */
export function canvasLooksLight(
  body: SrgbColor | null,
  root: SrgbColor | null,
  negotiatedDark: boolean,
): boolean {
  for (const color of [body, root]) {
    if (color && color.a >= 0.9) return relativeLuminance(color) >= LIGHT_LUMINANCE;
  }
  return !negotiatedDark;
}

/** Cookie banners and full-page dialogs should not decide the authored theme. */
export function isLikelyViewportOverlay(geometry: ViewportOverlayGeometry): boolean {
  if (geometry.viewportWidth <= 0 || geometry.viewportHeight <= 0) return false;
  const covers = geometry.width >= geometry.viewportWidth * 0.8 &&
    geometry.height >= geometry.viewportHeight * 0.35;
  if (!covers) return false;
  const role = (geometry.role ?? '').toLowerCase();
  const dialog = role === 'dialog' || role === 'alertdialog' || geometry.tagName === 'DIALOG';
  if (dialog) return true;
  const zIndex = Number.parseInt(geometry.zIndex, 10);
  const highZ = Number.isFinite(zIndex) && zIndex >= 100;
  const positioned = geometry.position === 'fixed' || geometry.position === 'sticky';
  return positioned && highZ;
}

function decision(
  kind: NativeThemeKind,
  reason: string,
  evidence: NativeThemeEvidence,
): NativeThemeDecision {
  return {kind, reason, evidence};
}
