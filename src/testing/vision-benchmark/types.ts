import type {VisionEvaluationReport} from '../../vision';

export const KNOWN_LABELS = ['photo', 'icon', 'diagram', 'screenshot'] as const;

export type KnownLabel = (typeof KNOWN_LABELS)[number];
export type CorpusLabel = KnownLabel | 'unknown';
export type TargetSplit = 'train' | 'val' | 'test';

export interface CorpusManifestRecord {
  schema: 'semantic-dark.corpus.v1';
  id: string;
  label: CorpusLabel;
  source: string;
  source_group: string;
  target_split: TargetSplit;
  path: string;
  sha256: string;
  raw_sha256: string;
  original_width: number;
  original_height: number;
  license: string;
  revision: string;
}

export interface LocatedCorpusRecord {
  record: CorpusManifestRecord;
  absolutePath: string;
}

export interface PredictionRow {
  schema: 'semantic-dark.prediction.v2';
  id: string;
  source: string;
  source_group: string;
  sha256: string;
  raw_sha256: string;
  label: CorpusLabel;
  target_split: TargetSplit;
  probabilities: Record<KnownLabel, number>;
  raw_predicted: KnownLabel | null;
  acceptance_score: number;
  score_semantics: string;
  predictor_id: string;
  operating_threshold: number;
  predicted: KnownLabel | null;
  abstained: boolean;
}

export interface OpenSetMetrics {
  knownTotal: number;
  knownAccepted: number;
  knownCoverage: number | null;
  knownSelectiveAccuracy: number | null;
  unknownTotal: number;
  unknownFalseAccepts: number;
  unknownFalseAcceptRate: number | null;
  overallAbstainRate: number | null;
}

export interface LatencyMetrics {
  scope: 'pixel-classifier-only';
  sampleCount: number;
  totalMs: number;
  meanMs: number | null;
  p95Ms: number | null;
}

export interface BenchmarkMetrics {
  schema: 'semantic-dark.benchmark.v1';
  predictorId: string;
  scoreSemantics: string;
  split: TargetSplit;
  operatingThreshold: number;
  sampleIdentitySha256: string;
  classification: VisionEvaluationReport<KnownLabel> | null;
  openSet: OpenSetMetrics;
  latency?: LatencyMetrics;
}

export interface ThresholdCurvePoint {
  threshold: number;
  macroF1: number | null;
  knownCoverage: number | null;
  unknownFalseAcceptRate: number | null;
}

export interface ThresholdCalibration {
  schema: 'semantic-dark.threshold-calibration.v1';
  targetUnknownFalseAcceptRate: number;
  threshold: number;
  validation: BenchmarkMetrics;
  curve: readonly ThresholdCurvePoint[];
}
