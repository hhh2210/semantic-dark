import {loadHeldOutThemePair} from './heldout-source';
import {materialThemePair, normalizedTokenHash} from './material';
import {primerThemePair} from './primer';
import {spectrumThemePair} from './spectrum';
import type {NormalizedThemePair, PairedThemeProtocol} from './types';

export interface ResolvedPairedThemeSource {
  theme: NormalizedThemePair;
  normalizedTokensSha256: string;
}

/** Resolve a pinned protocol source behind one source-agnostic runner boundary. */
export function resolvePairedThemeSource(
  source: PairedThemeProtocol['source'],
): ResolvedPairedThemeSource {
  switch (source.system) {
    case 'material': {
      const theme = materialThemePair(source);
      return {theme, normalizedTokensSha256: normalizedTokenHash(theme)};
    }
    case 'primer': {
      const theme = primerThemePair(source);
      return {theme, normalizedTokensSha256: normalizedTokenHash(theme)};
    }
    case 'spectrum': {
      const theme = spectrumThemePair(source);
      return {theme, normalizedTokensSha256: normalizedTokenHash(theme)};
    }
    case 'carbon':
    case 'fluent': {
      const theme = loadHeldOutThemePair(source);
      return {theme, normalizedTokensSha256: normalizedTokenHash(theme)};
    }
  }
}
