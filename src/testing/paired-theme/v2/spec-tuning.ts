import {COLOR_ROLES, type ColorRole} from '../../../color/role-profiles';
import type {V2SystemRegistryEntry} from './contract';
import {
  specBoolean,
  specExactArray,
  specExactKeys,
  specExactNumber,
  specExactString,
  specFinite,
  specObject,
} from './spec-shape';

type TunableField = 'minimumLightness' | 'lightnessSpan' | 'chromaScale';

export interface V2TuningSpec {
  schema: 'semantic-dark.profile-tuning.v2';
  developmentSystemIds: readonly string[];
  solverPolicy: 'frozen-no-changes';
  searchSpace: {
    roles: readonly ColorRole[];
    fields: readonly TunableField[];
    absoluteBounds: Record<TunableField, {minimum: number; maximum: number}>;
    coordinateDeltas: Record<TunableField, readonly number[]>;
    constraints: readonly ['minimumLightness+lightnessSpan<=1', 'all-values-finite'];
  };
  search: {
    method: 'deterministic-coordinate-descent';
    start: 'baseline-profile.v2';
    coordinateOrder: 'roles-then-fields-as-listed';
    maximumPasses: 4;
    stop: 'first-pass-with-no-accepted-coordinate-change';
    cacheKey: 'profile-semantic-sha256';
    tieBreak: 'maximin-improvement-vector-then-semantic-sha256';
  };
  objective: {
    kind: 'maximin-per-system-absolute-e-reduction';
    formula: 'min_s(E_baseline_s-E_candidate_s)';
    minimumImprovementPerSystem: 0.01;
    pooledAggregation: 'forbidden';
    componentNonRegressionTolerance: number;
    requireNoNewOrWorsenedF: true;
    requireM0InvariantsAndOpenFindingsNonRegression: true;
  };
  selection: {
    finalCandidates: 1;
    qualifyingOnly: true;
    noQualifyingCandidate: 'stop-before-phase-c-and-report-no-go';
    productDefaultsChangeInsideGoal: false;
  };
  planAmendment: 'original-failure-fixture-clause-replaced-by-frozen-development-margin';
}

const FIELDS = ['minimumLightness', 'lightnessSpan', 'chromaScale'] as const;
const BOUNDS = {
  minimumLightness: {minimum: 0, maximum: 0.9},
  lightnessSpan: {minimum: 0.02, maximum: 0.5},
  chromaScale: {minimum: 0.4, maximum: 1},
} as const;
const DELTAS = {
  minimumLightness: [-0.04, -0.02, 0, 0.02, 0.04],
  lightnessSpan: [-0.04, -0.02, 0, 0.02, 0.04],
  chromaScale: [-0.1, -0.05, 0, 0.05, 0.1],
} as const;

/** Validate the deterministic M2 search without accepting solver or system overrides. */
export function validateV2TuningSpec(
  value: unknown,
  systems: readonly V2SystemRegistryEntry[],
  componentTolerance: number,
): V2TuningSpec {
  const input = specObject(value, 'tuning');
  specExactKeys(input, ['schema', 'developmentSystemIds', 'solverPolicy', 'searchSpace',
    'search', 'objective', 'selection', 'planAmendment'], 'tuning');
  const development = systems.filter((system) => system.purpose === 'development').map((system) => system.id);
  return {
    schema: specExactString(input.schema, 'semantic-dark.profile-tuning.v2', 'tuning.schema'),
    developmentSystemIds: specExactArray(input.developmentSystemIds, development,
      'tuning.developmentSystemIds'),
    solverPolicy: specExactString(input.solverPolicy, 'frozen-no-changes', 'tuning.solverPolicy'),
    searchSpace: searchSpace(input.searchSpace), search: search(input.search),
    objective: objective(input.objective, componentTolerance), selection: selection(input.selection),
    planAmendment: specExactString(input.planAmendment,
      'original-failure-fixture-clause-replaced-by-frozen-development-margin',
      'tuning.planAmendment'),
  };
}

function searchSpace(value: unknown): V2TuningSpec['searchSpace'] {
  const input = specObject(value, 'tuning.searchSpace');
  specExactKeys(input, ['roles', 'fields', 'absoluteBounds', 'coordinateDeltas', 'constraints'],
    'tuning.searchSpace');
  return {
    roles: specExactArray(input.roles, COLOR_ROLES, 'searchSpace.roles') as readonly ColorRole[],
    fields: specExactArray(input.fields, FIELDS, 'searchSpace.fields') as readonly TunableField[],
    absoluteBounds: numericMaps(input.absoluteBounds, BOUNDS, 'absoluteBounds'),
    coordinateDeltas: deltaMaps(input.coordinateDeltas),
    constraints: specExactArray(input.constraints,
      ['minimumLightness+lightnessSpan<=1', 'all-values-finite'], 'searchSpace.constraints') as
      readonly ['minimumLightness+lightnessSpan<=1', 'all-values-finite'],
  };
}

function search(value: unknown): V2TuningSpec['search'] {
  const input = specObject(value, 'tuning.search');
  specExactKeys(input, ['method', 'start', 'coordinateOrder', 'maximumPasses', 'stop',
    'cacheKey', 'tieBreak'], 'tuning.search');
  return {method: specExactString(input.method, 'deterministic-coordinate-descent', 'search.method'),
    start: specExactString(input.start, 'baseline-profile.v2', 'search.start'),
    coordinateOrder: specExactString(input.coordinateOrder,
      'roles-then-fields-as-listed', 'search.coordinateOrder'),
    maximumPasses: specExactNumber(input.maximumPasses, 4, 'search.maximumPasses'),
    stop: specExactString(input.stop, 'first-pass-with-no-accepted-coordinate-change', 'search.stop'),
    cacheKey: specExactString(input.cacheKey, 'profile-semantic-sha256', 'search.cacheKey'),
    tieBreak: specExactString(input.tieBreak,
      'maximin-improvement-vector-then-semantic-sha256', 'search.tieBreak')};
}

function objective(value: unknown, tolerance: number): V2TuningSpec['objective'] {
  const input = specObject(value, 'tuning.objective');
  specExactKeys(input, ['kind', 'formula', 'minimumImprovementPerSystem', 'pooledAggregation',
    'componentNonRegressionTolerance', 'requireNoNewOrWorsenedF',
    'requireM0InvariantsAndOpenFindingsNonRegression'], 'tuning.objective');
  return {kind: specExactString(input.kind, 'maximin-per-system-absolute-e-reduction', 'objective.kind'),
    formula: specExactString(input.formula, 'min_s(E_baseline_s-E_candidate_s)', 'objective.formula'),
    minimumImprovementPerSystem: specExactNumber(input.minimumImprovementPerSystem, 0.01,
      'objective.minimumImprovementPerSystem'),
    pooledAggregation: specExactString(input.pooledAggregation, 'forbidden', 'pooledAggregation'),
    componentNonRegressionTolerance: specExactNumber(input.componentNonRegressionTolerance,
      tolerance, 'objective.componentNonRegressionTolerance'),
    requireNoNewOrWorsenedF: specBoolean(input.requireNoNewOrWorsenedF, true,
      'requireNoNewOrWorsenedF') as true,
    requireM0InvariantsAndOpenFindingsNonRegression: specBoolean(
      input.requireM0InvariantsAndOpenFindingsNonRegression, true,
      'requireM0InvariantsAndOpenFindingsNonRegression') as true};
}

function selection(value: unknown): V2TuningSpec['selection'] {
  const input = specObject(value, 'tuning.selection');
  specExactKeys(input, ['finalCandidates', 'qualifyingOnly', 'noQualifyingCandidate',
    'productDefaultsChangeInsideGoal'], 'tuning.selection');
  return {finalCandidates: specExactNumber(input.finalCandidates, 1, 'selection.finalCandidates'),
    qualifyingOnly: specBoolean(input.qualifyingOnly, true, 'selection.qualifyingOnly') as true,
    noQualifyingCandidate: specExactString(input.noQualifyingCandidate,
      'stop-before-phase-c-and-report-no-go', 'selection.noQualifyingCandidate'),
    productDefaultsChangeInsideGoal: specBoolean(input.productDefaultsChangeInsideGoal, false,
      'selection.productDefaultsChangeInsideGoal') as false};
}

function numericMaps<T extends Record<TunableField, {minimum: number; maximum: number}>>(
  value: unknown,
  expected: T,
  label: string,
): T {
  const input = specObject(value, label);
  specExactKeys(input, FIELDS, label);
  return Object.fromEntries(FIELDS.map((field) => {
    const range = specObject(input[field], `${label}.${field}`);
    specExactKeys(range, ['minimum', 'maximum'], `${label}.${field}`);
    return [field, {minimum: specExactNumber(range.minimum, expected[field].minimum, `${field}.minimum`),
      maximum: specExactNumber(range.maximum, expected[field].maximum, `${field}.maximum`)}];
  })) as T;
}

function deltaMaps(value: unknown): V2TuningSpec['searchSpace']['coordinateDeltas'] {
  const input = specObject(value, 'coordinateDeltas');
  specExactKeys(input, FIELDS, 'coordinateDeltas');
  return Object.fromEntries(FIELDS.map((field) => {
    if (!Array.isArray(input[field])) throw new TypeError(`coordinateDeltas.${field} must be an array`);
    const actual = input[field].map((item, index) => specFinite(item, `${field}[${index}]`));
    const expected = DELTAS[field];
    if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
      throw new Error(`coordinateDeltas.${field} does not match the frozen search space`);
    }
    return [field, actual];
  })) as unknown as V2TuningSpec['searchSpace']['coordinateDeltas'];
}
