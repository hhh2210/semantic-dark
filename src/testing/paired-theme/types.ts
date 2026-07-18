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

export interface PrimerProtocolSource {
  system: 'primer';
  kind: 'static-token-json';
  package: PackagePin;
  lightPath: 'dist/docs/functional/themes/light.json';
  darkPath: 'dist/docs/functional/themes/dark.json';
}

export interface SpectrumProtocolSource {
  system: 'spectrum';
  kind: 'cascade-token-json';
  package: PackagePin;
  schemaPackage: PackagePin;
  tokenPaths: readonly [
    'tokens/color-palette.tokens.json',
    'tokens/semantic-color-palette.tokens.json',
    'tokens/color-aliases.tokens.json',
    'tokens/color-component.tokens.json',
  ];
  modeSetPath: 'mode-sets/color-scheme.json';
  modes: {light: 'light'; dark: 'dark'};
  schema: {
    specVersion: '1.0.0-draft';
    tokenSchemaId: 'https://opensource.adobe.com/spectrum-design-data/schemas/v0/token.schema.json';
    modeSetSchemaId: 'https://opensource.adobe.com/spectrum-design-data/schemas/v0/mode-set.schema.json';
  };
}

export type FrozenTokenSelectors = Readonly<Record<NormalizedTokenName, string>>;

export interface CarbonProtocolSource {
  system: 'carbon';
  kind: 'exported-theme-object';
  package: PackagePin;
  lightExport: 'white';
  darkExport: 'g100';
  tokens: FrozenTokenSelectors;
}

export interface FluentProtocolSource {
  system: 'fluent';
  kind: 'exported-theme-object';
  package: PackagePin;
  lightExport: 'webLightTheme';
  darkExport: 'webDarkTheme';
  tokens: FrozenTokenSelectors;
}

export type DevelopmentProtocolSource =
  | MaterialProtocolSource
  | PrimerProtocolSource
  | SpectrumProtocolSource;

export type HeldOutProtocolSource = CarbonProtocolSource | FluentProtocolSource;
export type PairedThemeProtocolSource = DevelopmentProtocolSource | HeldOutProtocolSource;

export interface PairedThemeMetricConfig {
  status: 'development-draft' | 'frozen-v1';
  deltaEOkCap: number;
  contrastLog2Cap: number;
  rankTieEpsilon: number;
  comparisonEpsilon: number;
  accentChromaThreshold: number;
  textContrastFloor: number;
  nonTextContrastFloor: number;
  surfaceSeparationFloor: number;
  componentWeights: {
    color: number;
    contrast: number;
    rank: number;
  };
}

export interface FrozenMetricSpecReference {
  id: 'semantic-dark.paired-theme-metric.v1';
  path: '../evaluation/metric-spec.v1.json';
  sha256: string;
}

export interface PairedThemeProtocol {
  schema: 'semantic-dark.paired-theme-protocol.v1';
  id: string;
  split: EvaluationSplit;
  source: PairedThemeProtocolSource;
  sceneManifest: string;
  viewport: {width: number; height: number; deviceScaleFactor: number};
  locale: string;
  colorProfile: 'srgb';
  limits: {maxScenes: number; maxReviewedDecisions: number};
  metricSpec: FrozenMetricSpecReference;
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
  resolutionPath?: {light: readonly string[]; dark: readonly string[]};
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
