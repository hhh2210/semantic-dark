import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {
  KNOWN_LABELS,
  type CorpusLabel,
  type KnownLabel,
  type PredictionRow,
  type TargetSplit,
} from './types';

const LABELS = new Set<CorpusLabel>([...KNOWN_LABELS, 'unknown']);
const SPLITS = new Set<TargetSplit>(['train', 'val', 'test']);
const KNOWN = new Set<string>(KNOWN_LABELS);
const SHA256 = /^[0-9a-f]{64}$/;

export async function readPredictionFile(
  value: string,
  expectedSplit?: TargetSplit,
): Promise<PredictionRow[]> {
  const text = await readFile(path.resolve(value), 'utf8');
  const parsed: unknown[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid prediction JSON at line ${index + 1}`, {cause: error});
    }
  }
  return parsePredictionRows(parsed, expectedSplit);
}

export function parsePredictionRows(
  values: readonly unknown[],
  expectedSplit?: TargetSplit,
): PredictionRow[] {
  if (values.length === 0) throw new Error('Prediction file must not be empty');
  const rows = values.map((value, index) => parsePredictionRow(value, index + 1));
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`Duplicate prediction id: ${row.id}`);
    ids.add(row.id);
    if (expectedSplit && row.target_split !== expectedSplit) {
      throw new Error(`Prediction ${row.id} is ${row.target_split}, expected ${expectedSplit}`);
    }
  }
  return rows;
}

export function assertFormalPredictionCoverage(
  rows: readonly PredictionRow[],
  split: 'val' | 'test',
): void {
  const labels = new Set(rows.map((row) => row.label));
  const missing = [...KNOWN_LABELS, 'unknown' as const].filter((label) => !labels.has(label));
  if (missing.length > 0) {
    throw new Error(`${split} predictions are missing labels: ${missing.join(', ')}`);
  }
}

export function assertPredictionSetsDisjoint(
  validation: readonly PredictionRow[],
  test: readonly PredictionRow[],
): void {
  const validationKeys = new Set<string>();
  for (const row of validation) {
    for (const key of identityKeys(row)) validationKeys.add(key);
  }
  const leaks = new Set<string>();
  for (const row of test) {
    for (const key of identityKeys(row)) {
      if (validationKeys.has(key)) leaks.add(key);
    }
  }
  if (leaks.size > 0) {
    throw new Error(`Validation/test prediction leakage: ${[...leaks].slice(0, 5).join('; ')}`);
  }
}

function parsePredictionRow(value: unknown, line: number): PredictionRow {
  if (!value || typeof value !== 'object') throw invalid(line, 'row is not an object');
  const row = value as Record<string, unknown>;
  if (row.schema !== 'semantic-dark.prediction.v2') throw invalid(line, 'bad schema');
  for (const key of [
    'id',
    'source',
    'source_group',
    'sha256',
    'raw_sha256',
    'score_semantics',
    'predictor_id',
  ] as const) {
    if (typeof row[key] !== 'string' || !row[key].trim()) throw invalid(line, `${key} is required`);
  }
  if (!SHA256.test(row.sha256 as string) || !SHA256.test(row.raw_sha256 as string)) {
    throw invalid(line, 'bad sha256');
  }
  if (!LABELS.has(row.label as CorpusLabel)) throw invalid(line, 'bad label');
  if (!SPLITS.has(row.target_split as TargetSplit)) throw invalid(line, 'bad split');
  const rawPredicted = row.raw_predicted;
  const predicted = row.predicted;
  if (rawPredicted !== null && !KNOWN.has(rawPredicted as string)) {
    throw invalid(line, 'bad raw_predicted');
  }
  if (predicted !== null && !KNOWN.has(predicted as string)) throw invalid(line, 'bad predicted');
  const acceptanceScore = ratio(row.acceptance_score, line, 'acceptance_score');
  const operatingThreshold = ratio(row.operating_threshold, line, 'operating_threshold');
  if (!row.probabilities || typeof row.probabilities !== 'object') {
    throw invalid(line, 'probabilities are required');
  }
  const probabilityObject = row.probabilities as Record<string, unknown>;
  const keys = Object.keys(probabilityObject).sort();
  if (keys.join(',') !== [...KNOWN_LABELS].sort().join(',')) {
    throw invalid(line, 'probabilities must contain exactly the four known labels');
  }
  const probabilities = Object.fromEntries(KNOWN_LABELS.map((label) => [
    label,
    ratio(probabilityObject[label], line, `probabilities.${label}`),
  ])) as Record<KnownLabel, number>;
  const total = KNOWN_LABELS.reduce((sum, label) => sum + probabilities[label], 0);
  if (Math.abs(total - 1) > 1e-6) throw invalid(line, `probabilities sum to ${total}`);
  for (const label of KNOWN_LABELS) probabilities[label] /= total;
  const expected = rawPredicted !== null && acceptanceScore >= operatingThreshold
    ? rawPredicted
    : null;
  if (predicted !== expected || row.abstained !== (expected === null)) {
    throw invalid(line, 'predicted/abstained disagree with raw prediction and threshold');
  }
  return {...row, probabilities} as unknown as PredictionRow;
}

function identityKeys(row: PredictionRow): string[] {
  return [
    `id:${row.id}`,
    `source-group:${row.source_group}`,
    `normalized-sha256:${row.sha256}`,
    `raw-sha256:${row.raw_sha256}`,
  ];
}

function ratio(value: unknown, line: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid(line, `${field} must be in [0, 1]`);
  }
  return value;
}

function invalid(line: number, reason: string): Error {
  return new Error(`Invalid prediction line ${line}: ${reason}`);
}
