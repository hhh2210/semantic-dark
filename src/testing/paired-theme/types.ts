import type {ColorRole} from '../../color';

export const NORMALIZED_TOKEN_NAMES = [
  'canvas',
  'surface',
  'surfaceRaised',
  'textPrimary',
  'textSecondary',
  'tableHeader',
  'selectedSurface',
  'border',
  'focus',
  'dangerSurface',
  'dangerText',
] as const;

export type NormalizedTokenName = (typeof NORMALIZED_TOKEN_NAMES)[number];
export type PairedThemeSystem = 'material' | 'primer' | 'spectrum' | 'carbon' | 'fluent';
export type EvaluationSplit = 'development' | 'held-out';
export type PaintProperty = 'background-color' | 'color' | 'border-color' | 'outline-color';
export type PaintPseudo = null | '::before' | '::after';
export type ContrastKind = 'none' | 'text' | 'non-text';
export type SceneKind = 'surface-stack' | 'table-selection' | 'form-focus' | 'status-alert';
export type ObservationVariant = 'light' | 'authored-dark' | 'baseline-candidate';

export interface PackagePin {
  name: string;
  version: string;
  integrity: string;
  license: string;
  repository: string;
}

export interface MaterialGeneratorConfig {
  seed: string;
  variant: 'tonal-spot';
  specVersion: '2021';
  platform: 'phone';
  contrastLevel: number;
}

export interface MaterialProtocolSource {
  system: 'material';
  kind: 'generated-scheme';
  package: PackagePin;
  generator: MaterialGeneratorConfig;
}

export interface PairedThemeMetricConfig {
  status: 'development-draft' | 'frozen-v1';
  deltaEOkCap: number;
  contrastLog2Cap: number;
  rankTieEpsilon: number;
  componentWeights: {
    color: number;
    contrast: number;
    rank: number;
  };
}

export interface PairedThemeProtocol {
  schema: 'semantic-dark.paired-theme-protocol.v1';
  id: string;
  split: EvaluationSplit;
  source: MaterialProtocolSource;
  sceneManifest: string;
  viewport: {width: number; height: number; deviceScaleFactor: number};
  locale: string;
  colorProfile: 'srgb';
  limits: {maxScenes: number; maxReviewedDecisions: number};
  metric: PairedThemeMetricConfig;
}

export interface PaintDecision {
  id: string;
  component: string;
  state: string;
  property: PaintProperty;
  pseudo: PaintPseudo;
  role: ColorRole;
  token: NormalizedTokenName;
  backdropPaintId: string | null;
  contrastKind: ContrastKind;
  reviewed: boolean;
}

export interface SurfacePair {
  id: string;
  lowerPaintId: string;
  upperPaintId: string;
}

export interface SceneDefinition {
  id: string;
  kind: SceneKind;
  title: string;
  paints: PaintDecision[];
  surfacePairs: SurfacePair[];
}

export interface SceneManifest {
  schema: 'semantic-dark.paired-theme-scenes.v1';
  scenes: SceneDefinition[];
}

export interface NormalizedTokenPair {
  name: NormalizedTokenName;
  light: string;
  dark: string;
  sourceToken: string;
  provenance: 'generator-derived' | 'authored-token';
}

export interface NormalizedThemePair {
  system: PairedThemeSystem;
  split: EvaluationSplit;
  source: PackagePin;
  generatorConfig?: MaterialGeneratorConfig;
  tokens: Record<NormalizedTokenName, NormalizedTokenPair>;
}

export interface PaintObservation {
  schema: 'semantic-dark.paint-observation.v1';
  system: PairedThemeSystem;
  split: EvaluationSplit;
  variant: ObservationVariant;
  sceneId: string;
  paintId: string;
  component: string;
  state: string;
  property: PaintProperty;
  pseudo: PaintPseudo;
  role: ColorRole;
  backdropPaintId: string | null;
  contrastKind: ContrastKind;
  reviewed: boolean;
  value: string;
  opacity: string;
  display: string;
  visibility: string;
  rect: {x: number; y: number; width: number; height: number};
}
