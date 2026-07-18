import type {ColorRole} from '../../color';
import type {PairedThemeSystem} from './types';

export interface ColorMetricRow {
  id: string;
  system: PairedThemeSystem;
  sceneId: string;
  role: ColorRole;
  decisionId: string;
  deltaOk: number;
  cap: number;
  loss: number;
}

export interface ContrastMetricRow {
  id: string;
  system: PairedThemeSystem;
  sceneId: string;
  role: ColorRole;
  decisionId: string;
  contrastKind: 'text' | 'non-text';
  backdropPaintId: string;
  candidateRatio: number;
  authoredRatio: number;
  absoluteLog2Error: number;
  cap: number;
  loss: number;
  floor: number;
  candidatePass: boolean;
}

export interface RankMetricRow {
  id: string;
  system: PairedThemeSystem;
  sceneId: string;
  pairId: string;
  lowerPaintId: string;
  upperPaintId: string;
  tieEpsilon: number;
  candidateDeltaL: number;
  authoredDeltaL: number;
  candidateRelation: -1 | 0 | 1;
  authoredRelation: -1 | 0 | 1;
  loss: 0 | 0.5 | 1;
  candidateSeparationRatio: number;
  separationFloor: number;
  separationPass: boolean;
  inversion: boolean;
  tieMismatch: boolean;
}

export interface AutomaticFinding {
  id: string;
  source: 'automatic';
  rule: 'text-contrast' | 'non-text-contrast' | 'surface-separation' | 'surface-rank-reversal';
  severity: 'F';
  sceneId: string;
  targetId: string;
  observed: number;
  threshold: number;
  comparison: 'baseline-open';
  vetoApplicable: false;
  message: string;
}

export interface MetricDenominators {
  scenes: number;
  paintsPerVariant: number;
  observations: number;
  reviewedDecisions: number;
  colorRows: number;
  contrastRows: number;
  rankPairs: number;
  colorByRole: Readonly<Record<string, number>>;
  contrastByRole: Readonly<Record<string, number>>;
}

export interface PairedThemeSystemEvaluation {
  schema: 'semantic-dark.paired-theme-system-evaluation.v1';
  system: PairedThemeSystem;
  split: 'development' | 'held-out';
  status: 'valid';
  counts: MetricDenominators;
  rows: {
    color: readonly ColorMetricRow[];
    contrast: readonly ContrastMetricRow[];
    rank: readonly RankMetricRow[];
  };
  primary: {
    d: number;
    c: number;
    r: number;
    e: number;
    pairScore: number;
    relativeErrorReduction: {
      formula: '(E_baseline-E_candidate)/E_baseline';
      baselineE: number;
      candidateE: null;
      value: null;
      status: 'not-applicable-baseline-only';
    };
  };
  secondary: {
    contrastErrorRaw: number;
    surfaceRankInversionRate: number;
    surfaceRankTieMismatchCount: number;
    surfaceRankTieMismatchRate: number;
    accentHueErrorDegrees: number | null;
    accentHueEligible: number;
    accentHueLowChromaCandidates: number;
    hardFailureCount: number;
    textContrastFailures: number;
    nonTextContrastFailures: number;
    surfaceSeparationFailures: number;
    surfaceRankReversals: number;
    abstentions: 0;
  };
  findings: readonly AutomaticFinding[];
  manualSentinel: {
    status: 'not-run-in-m1-pair-evaluation';
    h3: null;
    h2: null;
    h1: null;
  };
}
