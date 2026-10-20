import {serializeCanonicalJson, sha256Text} from '../../artifacts';
import type {V2ArmEvaluation} from './evaluate-arm';
import type {FindingDelta, V2SystemComparison} from './evaluate';

export interface V2ReportProfilePin {
  semanticSha256: string;
  fileSha256: string;
}

export interface V2SystemReportProvenance extends Readonly<Record<string, unknown>> {
  system: string;
  metricSpecSha256: string;
  protocolId: string;
  protocolSha256: string;
  sceneManifestSha256: string;
  observationSha256: string;
  engineCommit: string;
  evaluatorCommit: string;
  profiles: {baseline: V2ReportProfilePin; candidate: V2ReportProfilePin};
}

export interface V2SystemReportInput {
  comparison: V2SystemComparison;
  provenance: V2SystemReportProvenance;
}

export type V2ReportedSystem = V2SystemComparison & {
  provenance: V2SystemReportProvenance;
};

interface MetricSummary {
  d: number; c: number; r: number; e: number; pairScore: number;
}

export interface V2PairedThemeReportResult {
  schema: 'semantic-dark.paired-theme-report-result.v2';
  metricSpecSha256: string;
  systemOrder: readonly string[];
  systems: readonly V2ReportedSystem[];
  descriptiveSystemMacro: {
    gateEligible: false;
    scope: 'descriptive-only-never-gate';
    systemCount: number;
    baseline: MetricSummary;
    candidate: MetricSummary;
  };
}

export interface V2PairedThemeReport {
  schema: 'semantic-dark.paired-theme-report.v2';
  result: V2PairedThemeReportResult;
  resultSha256: string;
}

/** Build a detached canonical report while preserving the frozen caller-provided system order. */
export function createV2PairedThemeReport(
  inputs: readonly V2SystemReportInput[],
): V2PairedThemeReport {
  if (inputs.length === 0) throw new Error('At least one v2 system comparison is required');
  const metricSpecSha256 = inputs[0]!.comparison.metricSpecSha256;
  const seen = new Set<string>();
  const systems = inputs.map(({comparison, provenance}) => {
    assertComparison(comparison);
    if (comparison.metricSpecSha256 !== metricSpecSha256) {
      throw new Error('V2 report cannot mix metric specs');
    }
    if (seen.has(comparison.system)) throw new Error(`Duplicate v2 system: ${comparison.system}`);
    seen.add(comparison.system);
    assertProvenance(comparison, provenance);
    return {...comparison, provenance};
  });
  const rawResult: V2PairedThemeReportResult = {
    schema: 'semantic-dark.paired-theme-report-result.v2',
    metricSpecSha256,
    systemOrder: systems.map((item) => item.system),
    systems,
    descriptiveSystemMacro: {
      gateEligible: false,
      scope: 'descriptive-only-never-gate',
      systemCount: systems.length,
      baseline: summarize(systems.map((item) => item.baseline)),
      candidate: summarize(systems.map((item) => item.candidate)),
    },
  };
  const result = canonicalClone(rawResult);
  return canonicalClone({
    schema: 'semantic-dark.paired-theme-report.v2' as const,
    result,
    resultSha256: sha256Text(serializeCanonicalJson(result)),
  });
}

export function serializeV2PairedThemeReportJson(report: V2PairedThemeReport): string {
  return serializeCanonicalJson(report);
}

/** Render a deterministic, dependency-free evidence view; it never computes a gate. */
export function renderV2PairedThemeReportHtml(report: V2PairedThemeReport): string {
  const systemRows = report.result.systems.map(armRows).join('');
  const counts = report.result.systems.map((system) => countBlock(system)).join('');
  const findings = report.result.systems.map(findingBlock).join('');
  const provenance = report.result.systems.map((system) =>
    `<details><summary>${escapeHtml(system.system)} provenance</summary><pre>${escapeHtml(
      serializeCanonicalJson(system.provenance),
    )}</pre></details>`).join('');
  const macro = report.result.descriptiveSystemMacro;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Semantic Dark paired-theme v2 report</title><style>${STYLES}</style></head>
<body><main><header><p class="eyebrow">Semantic Dark · evaluator v2</p><h1>Paired-theme comparison</h1>
<p>Baseline and M2 candidate are reported independently for every system. No aggregate is gate-eligible.</p>
<dl><div><dt>Metric spec SHA-256</dt><dd><code>${escapeHtml(report.result.metricSpecSha256)}</code></dd></div>
<div><dt>Canonical result SHA-256</dt><dd><code>${escapeHtml(report.resultSha256)}</code></dd></div></dl></header>
<section aria-labelledby="systems"><h2 id="systems">Per-system metrics</h2><div class="scroll"><table>
<caption>Lower D/C/R/E is better; PairScore and I are higher-is-better. NR means component non-regression.</caption>
<thead><tr><th scope="col">System</th><th scope="col">Arm</th><th scope="col">D</th><th scope="col">C</th><th scope="col">R</th><th scope="col">E</th><th scope="col">PairScore</th><th scope="col">I</th><th scope="col">D NR</th><th scope="col">C NR</th><th scope="col">R NR</th><th scope="col">New/worsened F</th></tr></thead>
<tbody>${systemRows}</tbody></table></div></section>
<section aria-labelledby="counts"><h2 id="counts">Frozen denominators</h2><div class="grid">${counts}</div></section>
<section aria-labelledby="macro"><h2 id="macro">Descriptive equal-system macro</h2>
<p class="warning"><strong>Descriptive only · never a gate.</strong> Per-system results cannot cancel one another.</p>
<div class="scroll"><table><thead><tr><th scope="col">Arm</th><th scope="col">D</th><th scope="col">C</th><th scope="col">R</th><th scope="col">E</th><th scope="col">PairScore</th><th scope="col">Gate eligible</th></tr></thead>
<tbody>${macroRow('Baseline', macro.baseline)}${macroRow('M2 candidate', macro.candidate)}</tbody></table></div></section>
<section aria-labelledby="findings"><h2 id="findings">Automatic F deltas</h2>${findings}</section>
<section aria-labelledby="provenance"><h2 id="provenance">Provenance</h2>${provenance}</section>
</main></body></html>`;
}

function assertComparison(value: V2SystemComparison): void {
  if (value.schema !== 'semantic-dark.paired-theme-system-comparison.v2') {
    throw new Error('Expected a v2 system comparison');
  }
  if (value.baseline.system !== value.system || value.candidate.system !== value.system ||
      value.baseline.split !== value.split || value.candidate.split !== value.split) {
    throw new Error(`V2 arm identity mismatch for ${value.system}`);
  }
  const counts = value.counts;
  if (counts.replicates !== value.replicateIds.length ||
      new Set(value.replicateIds).size !== value.replicateIds.length ||
      counts.rawObservationsPerReplicate !== counts.paintsPerVariant * counts.variants ||
      counts.rawObservationsAcrossReplicates !==
        counts.rawObservationsPerReplicate * counts.replicates ||
      counts.perArm.reviewed !== counts.perArm.color ||
      counts.comparison.color !== counts.perArm.color * 2 ||
      counts.comparison.contrast !== counts.perArm.contrast * 2 ||
      counts.comparison.rank !== counts.perArm.rank * 2) {
    throw new Error(`V2 report denominator mismatch for ${value.system}`);
  }
  for (const arm of [value.baseline, value.candidate]) assertArmCounts(value, arm);
  const relative = value.comparison.relativeImprovement;
  if (relative.baselineE !== value.baseline.primary.e ||
      relative.candidateE !== value.candidate.primary.e) {
    throw new Error(`V2 relative-improvement provenance mismatch for ${value.system}`);
  }
  const harmful = value.comparison.findingDeltas.filter((item) =>
    item.status === 'new' || item.status === 'worsened').length;
  if (harmful !== value.comparison.newOrWorsenedF) {
    throw new Error(`V2 F delta count mismatch for ${value.system}`);
  }
}

function assertArmCounts(system: V2SystemComparison, arm: V2ArmEvaluation): void {
  const actual = arm.counts;
  const expected = system.counts;
  if (actual.scenes !== expected.scenes || actual.paintsPerVariant !== expected.paintsPerVariant ||
      actual.reviewedDecisions !== expected.perArm.reviewed ||
      actual.colorRows !== expected.perArm.color ||
      actual.contrastRows !== expected.perArm.contrast || actual.rankPairs !== expected.perArm.rank) {
    throw new Error(`V2 arm denominator mismatch for ${system.system}`);
  }
}

function assertProvenance(
  comparison: V2SystemComparison,
  provenance: V2SystemReportProvenance,
): void {
  if (provenance.system !== comparison.system) throw new Error(
    `Provenance system ${provenance.system} does not match ${comparison.system}`,
  );
  if (provenance.metricSpecSha256 !== comparison.metricSpecSha256) throw new Error(
    `Provenance metric spec does not match ${comparison.system}`,
  );
  if (provenance.protocolSha256 !== comparison.protocolSha256) throw new Error(
    `Provenance protocol does not match ${comparison.system}`,
  );
  if (provenance.sceneManifestSha256 !== comparison.sceneManifestSha256) throw new Error(
    `Provenance scene manifest does not match ${comparison.system}`,
  );
  for (const [label, value] of [
    ['metric spec', provenance.metricSpecSha256], ['protocol', provenance.protocolSha256],
    ['scene manifest', provenance.sceneManifestSha256], ['observation', provenance.observationSha256],
    ['baseline semantic profile', provenance.profiles.baseline.semanticSha256],
    ['baseline profile file', provenance.profiles.baseline.fileSha256],
    ['candidate semantic profile', provenance.profiles.candidate.semanticSha256],
    ['candidate profile file', provenance.profiles.candidate.fileSha256],
  ] as const) {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} SHA-256 is invalid`);
  }
  if (!provenance.protocolId) {
    throw new Error(`Incomplete provenance for ${comparison.system}`);
  }
  for (const [label, value] of [
    ['engine', provenance.engineCommit], ['evaluator', provenance.evaluatorCommit],
  ] as const) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
      throw new Error(`${label} commit is invalid`);
    }
  }
}

function summarize(arms: readonly V2ArmEvaluation[]): MetricSummary {
  const mean = (key: keyof MetricSummary) =>
    arms.reduce((sum, arm) => sum + arm.primary[key], 0) / arms.length;
  return {d: mean('d'), c: mean('c'), r: mean('r'), e: mean('e'), pairScore: mean('pairScore')};
}

function armRows(system: V2ReportedSystem): string {
  const metrics = (arm: V2ArmEvaluation) =>
    `<td>${format(arm.primary.d)}</td><td>${format(arm.primary.c)}</td><td>${format(arm.primary.r)}</td><td>${format(arm.primary.e)}</td><td>${format(arm.primary.pairScore)}</td>`;
  const nr = system.comparison.componentNonRegression;
  const i = system.comparison.relativeImprovement.value;
  return `<tr><th rowspan="2" scope="rowgroup">${escapeHtml(system.system)}<small>${escapeHtml(system.split)}</small></th><th scope="row">Baseline</th>${metrics(system.baseline)}<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr class="candidate"><th scope="row">M2 candidate</th>${metrics(system.candidate)}<td>${i === null ? 'N/E' : `${format(i * 100)}%`}</td>${passCell(nr.d)}${passCell(nr.c)}${passCell(nr.r)}<td>${system.comparison.newOrWorsenedF}</td></tr>`;
}

function countBlock(system: V2ReportedSystem): string {
  const count = system.counts;
  return `<article><h3>${escapeHtml(system.system)}</h3><dl>
<div><dt>Raw observations</dt><dd>${count.rawObservationsPerReplicate} / replicate · ${count.rawObservationsAcrossReplicates} / ${count.replicates} replicates</dd></div>
<div><dt>Per arm D/C/R</dt><dd>${count.perArm.color}/${count.perArm.contrast}/${count.perArm.rank} · reviewed ${count.perArm.reviewed}</dd></div>
<div><dt>Comparison D/C/R</dt><dd>${count.comparison.color}/${count.comparison.contrast}/${count.comparison.rank}</dd></div>
</dl></article>`;
}

function findingBlock(system: V2ReportedSystem): string {
  const items = system.comparison.findingDeltas.length === 0
    ? '<li>None</li>'
    : system.comparison.findingDeltas.map((item: FindingDelta) =>
      `<li><code>${escapeHtml(item.id)}</code> <strong>${item.status}</strong>` +
      ` · baseline ${findingMeasure(item.baseline)} · candidate ${findingMeasure(item.candidate)}</li>`
    ).join('');
  return `<article><h3>${escapeHtml(system.system)} · ${system.comparison.newOrWorsenedF} new/worsened</h3><ul>${items}</ul></article>`;
}

function macroRow(label: string, value: MetricSummary): string {
  return `<tr><th scope="row">${label}</th><td>${format(value.d)}</td><td>${format(value.c)}</td><td>${format(value.r)}</td><td>${format(value.e)}</td><td>${format(value.pairScore)}</td><td>No</td></tr>`;
}

function passCell(value: boolean): string {
  return `<td class="${value ? 'pass' : 'fail'}">${value ? 'Pass' : 'Fail'}</td>`;
}

function findingMeasure(value: FindingDelta['baseline']): string {
  return value === null ? 'none' : `${format(value.observed)} / threshold ${format(value.threshold)}`;
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(serializeCanonicalJson(value)) as T;
}

function format(value: number): string {
  return value.toFixed(4);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const STYLES = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17202b}main{max-width:1200px;margin:auto;padding:40px 24px 72px}h1{font-size:clamp(2rem,5vw,3.5rem);margin:.15em 0}h2{margin-top:2.4rem}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-weight:700;color:#52657b}dl,.grid{display:grid;gap:12px}.grid{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}dl div,article,details{padding:14px;border:1px solid #ccd4de;border-radius:10px;background:#fff}dt{font-size:.75rem;color:#58687a}dd{margin:.35rem 0 0;overflow-wrap:anywhere}.scroll{overflow:auto;border:1px solid #ccd4de;border-radius:10px;background:#fff}table{border-collapse:collapse;width:100%;min-width:980px}caption{text-align:left;padding:13px}th,td{padding:11px;border-top:1px solid #dfe4ea;text-align:right}th:first-child{text-align:left}th small{display:block;color:#667487;font-weight:400}.candidate{background:#f7fbff}.pass{color:#176534;font-weight:700}.fail{color:#a02b2b;font-weight:700}.warning{border-left:4px solid #815b00;padding:10px 14px;background:#fff7dc}details{margin:10px 0}summary{cursor:pointer;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{font-family:ui-monospace,SFMono-Regular,monospace}@media(prefers-color-scheme:dark){body{background:#10141a;color:#edf2f7}dl div,article,details,.scroll{background:#181e26;border-color:#3b4654}.candidate{background:#172331}.warning{background:#2b250e}.eyebrow,dt,th small{color:#a9b7c8}th,td{border-color:#343e49}}@media print{:root{color-scheme:only light}body,dl div,article,details,.scroll,.candidate,.warning{background:#fff;color:#000}.scroll{overflow:visible}table{min-width:0;font-size:8pt}}`;
