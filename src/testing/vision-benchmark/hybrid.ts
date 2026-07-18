import type {PredictionRow} from './types';

/** Use one predictor's abstention score and another predictor's class routing. */
export function combineGateAndExpertPredictions(
  gateRows: readonly PredictionRow[],
  expertRows: readonly PredictionRow[],
): PredictionRow[] {
  if (gateRows.length !== expertRows.length) {
    throw new Error(`Hybrid inputs differ in size: ${gateRows.length} vs ${expertRows.length}`);
  }
  const experts = new Map(expertRows.map((row) => [row.id, row]));
  return gateRows.map((gate) => {
    const expert = experts.get(gate.id);
    if (!expert) throw new Error(`Hybrid expert is missing id ${gate.id}`);
    assertSameIdentity(gate, expert);
    const rawPredicted = gate.raw_predicted === null ? null : expert.raw_predicted;
    const accepted = rawPredicted !== null &&
      gate.acceptance_score >= gate.operating_threshold;
    return {
      ...gate,
      probabilities: expert.probabilities,
      raw_predicted: rawPredicted,
      predicted: accepted ? rawPredicted : null,
      abstained: !accepted,
      predictor_id: `hybrid:${gate.predictor_id}+${expert.predictor_id}`,
      score_semantics: `gate(${gate.score_semantics})+class(${expert.score_semantics})`,
    };
  });
}

function assertSameIdentity(gate: PredictionRow, expert: PredictionRow): void {
  for (const key of [
    'source',
    'source_group',
    'sha256',
    'raw_sha256',
    'label',
    'target_split',
  ] as const) {
    if (gate[key] !== expert[key]) {
      throw new Error(`Hybrid identity mismatch for ${gate.id}: ${key}`);
    }
  }
}
