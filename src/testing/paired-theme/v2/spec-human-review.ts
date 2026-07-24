import {
  specBoolean,
  specExactArray,
  specExactKeys,
  specExactNumber,
  specExactString,
  specIdentifier,
  specObject,
  specString,
  specStringArray,
} from './spec-shape';

export interface V2HumanReviewCase {
  id: string;
  category: 'native-dark' | 'light-only' | 'dynamic-mixed';
  states: readonly string[];
  expectedThemeDecision: string;
  primaryTask: string;
}

export interface V2HumanReviewSpec {
  schema: 'semantic-dark.human-review.v2';
  reviewer: {count: 1; owner: 'project-owner'};
  cases: readonly V2HumanReviewCase[];
  blinding: {
    labels: readonly ['A', 'B'];
    assignmentUnit: 'case';
    assignmentMethod: 'cryptographically-random-per-case';
    sealAlgorithm: 'sha256-canonical-json';
    sealedBefore: 'first-verdict';
    unblindAfter: 'all-cases-all-states-finalized';
    earlyUnblindingForbidden: true;
  };
  severityRubric: {
    H1: string;
    H2: string;
    H3: string;
  };
  reducer: 'worst-state-per-case';
  secondLook: {
    triggers: readonly ['H2', 'H3'];
    reviewer: 'same-project-owner';
    requiredBeforeFinalization: true;
    requiredBeforeUnblinding: true;
  };
  completion: {
    requiredCaseCount: 12;
    incompleteOutcome: 'not-evaluable';
    goPossibleWhenIncomplete: false;
  };
  capturePolicy: {
    mode: 'local-manual-public-no-auth-no-crawl';
    rawCapturesStoredInGit: false;
    redistribution: false;
  };
}

const H1 = 'Local aesthetic or hue/chroma regression without loss of meaning, readability, or interaction.';
const H2 = 'The main task remains possible, but primary table hierarchy, focus/selected/disabled state, diagram tracking, or a large bright region is bad enough that a user must disable the extension.';
const H3 = 'Primary content/control disappears or becomes unusable; status/chart meaning changes; protected media, logo, QR, or CAPTCHA is destructively recolored.';

/** Validate the executable blinded H protocol and its 12 fixed page/state cases. */
export function validateV2HumanReviewSpec(value: unknown): V2HumanReviewSpec {
  const input = specObject(value, 'humanReview');
  specExactKeys(input, ['schema', 'reviewer', 'cases', 'blinding', 'severityRubric',
    'reducer', 'secondLook', 'completion', 'capturePolicy'], 'humanReview');
  const cases = reviewCases(input.cases);
  return {
    schema: specExactString(input.schema, 'semantic-dark.human-review.v2', 'humanReview.schema'),
    reviewer: reviewer(input.reviewer), cases, blinding: blinding(input.blinding),
    severityRubric: severityRubric(input.severityRubric),
    reducer: specExactString(input.reducer, 'worst-state-per-case', 'humanReview.reducer'),
    secondLook: secondLook(input.secondLook), completion: completion(input.completion),
    capturePolicy: capturePolicy(input.capturePolicy),
  };
}

function reviewCases(value: unknown): readonly V2HumanReviewCase[] {
  if (!Array.isArray(value) || value.length !== 12) {
    throw new Error('humanReview.cases must contain exactly 12 cases');
  }
  const cases = value.map((item, index): V2HumanReviewCase => {
    const input = specObject(item, `humanReview.cases[${index}]`);
    specExactKeys(input, ['id', 'category', 'states', 'expectedThemeDecision', 'primaryTask'],
      `humanReview.cases[${index}]`);
    const category = input.category;
    if (category !== 'native-dark' && category !== 'light-only' &&
        category !== 'dynamic-mixed') throw new Error('Invalid human-review category');
    const states = specStringArray(input.states, `humanReview.cases[${index}].states`,
      {identifiers: true});
    if (states.length === 0) throw new Error('Every human-review case needs at least one state');
    return {id: specIdentifier(input.id, 'case id'), category, states,
      expectedThemeDecision: specString(input.expectedThemeDecision, 'expectedThemeDecision'),
      primaryTask: specString(input.primaryTask, 'primaryTask')};
  });
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error('humanReview.cases contains duplicate ids');
  }
  return cases;
}

function reviewer(value: unknown): V2HumanReviewSpec['reviewer'] {
  const input = specObject(value, 'humanReview.reviewer');
  specExactKeys(input, ['count', 'owner'], 'humanReview.reviewer');
  return {count: specExactNumber(input.count, 1, 'reviewer.count'),
    owner: specExactString(input.owner, 'project-owner', 'reviewer.owner')};
}

function blinding(value: unknown): V2HumanReviewSpec['blinding'] {
  const input = specObject(value, 'humanReview.blinding');
  specExactKeys(input, ['labels', 'assignmentUnit', 'assignmentMethod', 'sealAlgorithm',
    'sealedBefore', 'unblindAfter', 'earlyUnblindingForbidden'], 'humanReview.blinding');
  return {labels: specExactArray(input.labels, ['A', 'B'], 'blinding.labels') as readonly ['A', 'B'],
    assignmentUnit: specExactString(input.assignmentUnit, 'case', 'assignmentUnit'),
    assignmentMethod: specExactString(input.assignmentMethod,
      'cryptographically-random-per-case', 'assignmentMethod'),
    sealAlgorithm: specExactString(input.sealAlgorithm, 'sha256-canonical-json', 'sealAlgorithm'),
    sealedBefore: specExactString(input.sealedBefore, 'first-verdict', 'sealedBefore'),
    unblindAfter: specExactString(input.unblindAfter,
      'all-cases-all-states-finalized', 'unblindAfter'),
    earlyUnblindingForbidden: specBoolean(input.earlyUnblindingForbidden, true,
      'earlyUnblindingForbidden') as true};
}

function severityRubric(value: unknown): V2HumanReviewSpec['severityRubric'] {
  const input = specObject(value, 'humanReview.severityRubric');
  specExactKeys(input, ['H1', 'H2', 'H3'], 'humanReview.severityRubric');
  return {H1: specExactString(input.H1, H1, 'severityRubric.H1'),
    H2: specExactString(input.H2, H2, 'severityRubric.H2'),
    H3: specExactString(input.H3, H3, 'severityRubric.H3')};
}

function secondLook(value: unknown): V2HumanReviewSpec['secondLook'] {
  const input = specObject(value, 'humanReview.secondLook');
  specExactKeys(input, ['triggers', 'reviewer', 'requiredBeforeFinalization',
    'requiredBeforeUnblinding'], 'humanReview.secondLook');
  return {triggers: specExactArray(input.triggers, ['H2', 'H3'], 'secondLook.triggers') as
      readonly ['H2', 'H3'],
    reviewer: specExactString(input.reviewer, 'same-project-owner', 'secondLook.reviewer'),
    requiredBeforeFinalization: specBoolean(input.requiredBeforeFinalization, true,
      'requiredBeforeFinalization') as true,
    requiredBeforeUnblinding: specBoolean(input.requiredBeforeUnblinding, true,
      'requiredBeforeUnblinding') as true};
}

function completion(value: unknown): V2HumanReviewSpec['completion'] {
  const input = specObject(value, 'humanReview.completion');
  specExactKeys(input, ['requiredCaseCount', 'incompleteOutcome', 'goPossibleWhenIncomplete'],
    'humanReview.completion');
  return {requiredCaseCount: specExactNumber(input.requiredCaseCount, 12, 'requiredCaseCount'),
    incompleteOutcome: specExactString(input.incompleteOutcome, 'not-evaluable', 'incompleteOutcome'),
    goPossibleWhenIncomplete: specBoolean(input.goPossibleWhenIncomplete, false,
      'goPossibleWhenIncomplete') as false};
}

function capturePolicy(value: unknown): V2HumanReviewSpec['capturePolicy'] {
  const input = specObject(value, 'humanReview.capturePolicy');
  specExactKeys(input, ['mode', 'rawCapturesStoredInGit', 'redistribution'],
    'humanReview.capturePolicy');
  return {mode: specExactString(input.mode, 'local-manual-public-no-auth-no-crawl', 'capture mode'),
    rawCapturesStoredInGit: specBoolean(input.rawCapturesStoredInGit, false,
      'rawCapturesStoredInGit') as false,
    redistribution: specBoolean(input.redistribution, false, 'redistribution') as false};
}
