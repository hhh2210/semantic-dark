import {COLOR_ROLES, type ColorRole} from '../../../color/role-profiles';
import type {V2DenominatorContract, V2SystemRegistryEntry} from './contract';
import {
  specDigest,
  specExactKeys,
  specExactNumber,
  specExactString,
  specIdentifier,
  specObject,
  specString,
  specStringArray,
} from './spec-shape';

export interface V2ReviewedDecisionSpec {
  sceneId: string;
  paintId: string;
  role: ColorRole;
  token: string;
}

export interface V2ContrastDecisionSpec {
  sceneId: string;
  paintId: string;
  role: ColorRole;
  kind: 'text' | 'non-text';
  backdropPaintId: string;
}

export interface V2RankDecisionSpec {
  sceneId: string;
  pairId: string;
  lowerPaintId: string;
  upperPaintId: string;
}

export interface V2RecordsSpec {
  schema: 'semantic-dark.paired-theme-records.v2';
  sceneManifestPath: string;
  sceneManifestSha256: string;
  identity: 'system/sceneId/paintId';
  reviewed: readonly V2ReviewedDecisionSpec[];
  contrast: readonly V2ContrastDecisionSpec[];
  rank: readonly V2RankDecisionSpec[];
  aggregationCells: {
    colorRoleScene: readonly string[];
    contrastRoleScene: readonly string[];
    rankScenes: readonly string[];
    emptyCellPolicy: 'a-preregistered-empty-cell-invalidates-the-run';
  };
  totals: {
    activeSystems: number;
    reviewedPerSystem: number;
    totalReviewedRows: number;
    colorPerArm: number;
    contrastPerArm: number;
    rankPerArm: number;
  };
  missingPolicy: 'invalidate-run';
  extraPolicy: 'invalidate-run';
  duplicatePolicy: 'invalidate-run';
  abstentionPolicy: 'score-unchanged-light-paint; extraction-failure-is-not-abstention';
}

/** Validate the sole v2 record identity and its frozen aggregation cells. */
export function validateV2RecordsSpec(
  value: unknown,
  systems: readonly V2SystemRegistryEntry[],
  denominators: V2DenominatorContract,
): V2RecordsSpec {
  const input = specObject(value, 'records');
  specExactKeys(input, ['schema', 'sceneManifestPath', 'sceneManifestSha256', 'identity',
    'reviewed', 'contrast', 'rank', 'aggregationCells', 'totals', 'missingPolicy',
    'extraPolicy', 'duplicatePolicy', 'abstentionPolicy'], 'records');
  const sceneManifestPath = specString(input.sceneManifestPath, 'records.sceneManifestPath');
  const sceneManifestSha256 = specDigest(input.sceneManifestSha256, 'records.sceneManifestSha256');
  if (systems.some((system) => system.sceneManifestPath !== sceneManifestPath ||
      system.sceneManifestSha256 !== sceneManifestSha256)) {
    throw new Error('records scene manifest must match every registered system');
  }
  const reviewed = decisions(input.reviewed, denominators.perArm.reviewed, reviewedDecision);
  const contrast = decisions(input.contrast, denominators.perArm.contrast, contrastDecision);
  const rank = decisions(input.rank, denominators.perArm.rank, rankDecision);
  const reviewedIds = new Set(reviewed.map((row) => `${row.sceneId}/${row.paintId}`));
  for (const row of contrast) {
    if (!reviewedIds.has(`${row.sceneId}/${row.paintId}`)) {
      throw new Error(`Contrast record is not reviewed: ${row.sceneId}/${row.paintId}`);
    }
  }
  const cells = aggregationCells(input.aggregationCells, denominators);
  const totals = recordTotals(input.totals, denominators);
  return {
    schema: specExactString(input.schema, 'semantic-dark.paired-theme-records.v2', 'records.schema'),
    sceneManifestPath, sceneManifestSha256,
    identity: specExactString(input.identity, 'system/sceneId/paintId', 'records.identity'),
    reviewed, contrast, rank, aggregationCells: cells, totals,
    missingPolicy: specExactString(input.missingPolicy, 'invalidate-run', 'records.missingPolicy'),
    extraPolicy: specExactString(input.extraPolicy, 'invalidate-run', 'records.extraPolicy'),
    duplicatePolicy: specExactString(input.duplicatePolicy, 'invalidate-run', 'records.duplicatePolicy'),
    abstentionPolicy: specExactString(input.abstentionPolicy,
      'score-unchanged-light-paint; extraction-failure-is-not-abstention',
      'records.abstentionPolicy'),
  };
}

function decisions<T>(
  value: unknown,
  expected: number,
  validate: (value: unknown, index: number) => T,
): readonly T[] {
  if (!Array.isArray(value) || value.length !== expected) {
    throw new Error(`records decision list must contain exactly ${expected} entries`);
  }
  const rows = value.map(validate);
  const identities = rows.map((row) => decisionIdentity(row));
  if (new Set(identities).size !== identities.length) throw new Error('records decision list has duplicates');
  return rows;
}

function reviewedDecision(value: unknown, index: number): V2ReviewedDecisionSpec {
  const input = specObject(value, `records.reviewed[${index}]`);
  specExactKeys(input, ['sceneId', 'paintId', 'role', 'token'], `records.reviewed[${index}]`);
  return {sceneId: specIdentifier(input.sceneId, 'sceneId'), paintId: specIdentifier(input.paintId, 'paintId'),
    role: colorRole(input.role, 'role'), token: specIdentifier(input.token, 'token')};
}

function contrastDecision(value: unknown, index: number): V2ContrastDecisionSpec {
  const input = specObject(value, `records.contrast[${index}]`);
  specExactKeys(input, ['sceneId', 'paintId', 'role', 'kind', 'backdropPaintId'],
    `records.contrast[${index}]`);
  if (input.kind !== 'text' && input.kind !== 'non-text') throw new Error('Invalid contrast kind');
  return {sceneId: specIdentifier(input.sceneId, 'sceneId'), paintId: specIdentifier(input.paintId, 'paintId'),
    role: colorRole(input.role, 'role'), kind: input.kind,
    backdropPaintId: specIdentifier(input.backdropPaintId, 'backdropPaintId')};
}

function rankDecision(value: unknown, index: number): V2RankDecisionSpec {
  const input = specObject(value, `records.rank[${index}]`);
  specExactKeys(input, ['sceneId', 'pairId', 'lowerPaintId', 'upperPaintId'],
    `records.rank[${index}]`);
  return {sceneId: specIdentifier(input.sceneId, 'sceneId'), pairId: specIdentifier(input.pairId, 'pairId'),
    lowerPaintId: specIdentifier(input.lowerPaintId, 'lowerPaintId'),
    upperPaintId: specIdentifier(input.upperPaintId, 'upperPaintId')};
}

function aggregationCells(value: unknown, denominators: V2DenominatorContract) {
  const input = specObject(value, 'records.aggregationCells');
  specExactKeys(input, ['colorRoleScene', 'contrastRoleScene', 'rankScenes', 'emptyCellPolicy'],
    'records.aggregationCells');
  return {
    colorRoleScene: specStringArray(input.colorRoleScene, 'colorRoleScene',
      {length: denominators.perArm.color}),
    contrastRoleScene: specStringArray(input.contrastRoleScene, 'contrastRoleScene',
      {length: denominators.perArm.contrast}),
    rankScenes: specStringArray(input.rankScenes, 'rankScenes',
      {length: denominators.perArm.rank, identifiers: true}),
    emptyCellPolicy: specExactString(input.emptyCellPolicy,
      'a-preregistered-empty-cell-invalidates-the-run', 'emptyCellPolicy'),
  } as const;
}

function recordTotals(value: unknown, denominators: V2DenominatorContract) {
  const input = specObject(value, 'records.totals');
  specExactKeys(input, ['activeSystems', 'reviewedPerSystem', 'totalReviewedRows',
    'colorPerArm', 'contrastPerArm', 'rankPerArm'], 'records.totals');
  return {
    activeSystems: specExactNumber(input.activeSystems, denominators.reviewedSystems, 'activeSystems'),
    reviewedPerSystem: specExactNumber(input.reviewedPerSystem,
      denominators.perArm.reviewed, 'reviewedPerSystem'),
    totalReviewedRows: specExactNumber(input.totalReviewedRows,
      denominators.totalReviewedRows, 'totalReviewedRows'),
    colorPerArm: specExactNumber(input.colorPerArm, denominators.perArm.color, 'colorPerArm'),
    contrastPerArm: specExactNumber(input.contrastPerArm,
      denominators.perArm.contrast, 'contrastPerArm'),
    rankPerArm: specExactNumber(input.rankPerArm, denominators.perArm.rank, 'rankPerArm'),
  };
}

function decisionIdentity(value: unknown): string {
  const row = value as Record<string, string>;
  return `${row.sceneId}/${row.paintId ?? row.pairId}`;
}

function colorRole(value: unknown, label: string): ColorRole {
  if (!COLOR_ROLES.includes(value as ColorRole)) throw new Error(`${label} is not a color role`);
  return value as ColorRole;
}
