import {serializeCanonicalJson, sha256Text} from '../artifacts';
import type {PairedThemeSystemEvaluation} from './evaluation-types';
import type {
  EvaluationSplit,
  PackagePin,
  PairedThemeProtocol,
  PairedThemeSystem,
} from './types';

export interface PairedThemeReportProvenance {
  system: PairedThemeSystem;
  split: EvaluationSplit;
  evaluatorCommit: string;
  worktreeClean: boolean;
  protocolId: string;
  protocolSha256: string;
  m0ManifestSha256: string;
  sceneManifestSha256: string;
  normalizedTokensSha256: string;
  recordIdsSha256: string;
  metricPayloadSha256: string;
  baselineEngineCommit: string;
  metricSpecId: string;
  metricSpecSha256: string;
  metricFreezeCommit: string;
  roleProfilesSourceSha256: string;
  roleProfilesCanonicalSha256: string;
  source: PackagePin;
  browser: {name: 'Google Chrome'; version: string};
  nodeVersion: string;
  viewport: PairedThemeProtocol['viewport'];
  locale: string;
  colorProfile: 'srgb';
}

export interface PairedThemeReportInput {
  evaluation: PairedThemeSystemEvaluation;
  provenance: PairedThemeReportProvenance;
}

export type PairedThemeReportSystem = PairedThemeSystemEvaluation & {
  provenance: PairedThemeReportProvenance;
};

export interface PairedThemeReportResult {
  schema: 'semantic-dark.paired-theme-report-result.v1';
  systems: readonly PairedThemeReportSystem[];
  descriptiveSystemMacro: {
    gateEligible: false;
    systemCount: number;
    d: number;
    c: number;
    r: number;
    e: number;
    pairScore: number;
  };
}

export interface PairedThemeReport {
  schema: 'semantic-dark.paired-theme-report.v1';
  result: PairedThemeReportResult;
  resultSha256: string;
  reproducibility: {
    status: 'not-compared' | 'exact';
    comparedResultSha256: string | null;
  };
}

export function createPairedThemeReport(
  inputs: readonly PairedThemeReportInput[],
  reproducibility: PairedThemeReport['reproducibility'] = {
    status: 'not-compared',
    comparedResultSha256: null,
  },
): PairedThemeReport {
  if (inputs.length === 0) throw new Error('At least one system report input is required');
  const systems = inputs.map(({evaluation, provenance}) => {
    if (evaluation.system !== provenance.system) {
      throw new Error(`Provenance system ${provenance.system} does not match ${evaluation.system}`);
    }
    if (evaluation.split !== provenance.split) {
      throw new Error(`Provenance split ${provenance.split} does not match ${evaluation.split}`);
    }
    return {...evaluation, provenance};
  }).sort((left, right) => compare(left.system, right.system));
  const identities = new Set<string>();
  for (const system of systems) {
    if (identities.has(system.system)) throw new Error(`Duplicate system result: ${system.system}`);
    identities.add(system.system);
  }
  const result: PairedThemeReportResult = {
    schema: 'semantic-dark.paired-theme-report-result.v1',
    systems,
    descriptiveSystemMacro: {
      gateEligible: false,
      systemCount: systems.length,
      d: mean(systems.map((system) => system.primary.d)),
      c: mean(systems.map((system) => system.primary.c)),
      r: mean(systems.map((system) => system.primary.r)),
      e: mean(systems.map((system) => system.primary.e)),
      pairScore: mean(systems.map((system) => system.primary.pairScore)),
    },
  };
  const resultSha256 = sha256Text(serializeCanonicalJson(result));
  if (reproducibility.status === 'exact' && reproducibility.comparedResultSha256 !== resultSha256) {
    throw new Error('Exact reproducibility hash does not match this report result');
  }
  return {schema: 'semantic-dark.paired-theme-report.v1', result, resultSha256, reproducibility};
}

export function renderPairedThemeReportHtml(report: PairedThemeReport): string {
  const systems = report.result.systems;
  const reviewed = systems.reduce((sum, item) => sum + item.counts.reviewedDecisions, 0);
  const automaticFailures = systems.reduce((sum, item) => sum + item.secondary.hardFailureCount, 0);
  const allClean = systems.every((system) => system.provenance.worktreeClean);
  const reproducibility = report.reproducibility.status === 'exact' ? 'Exact' : 'Not compared';
  const cards = systems.map(systemCard).join('');
  const systemRows = systems.map(systemRow).join('');
  const sections = systems.map(systemSection).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Semantic Dark paired-theme evidence</title><style>${REPORT_STYLES}</style></head>
<body><a class="skip" href="#main">Skip to evidence</a><main id="main">
<header><p class="eyebrow">Semantic Dark · M1 evidence ledger</p><h1>Paired-theme baseline report</h1>
<p class="lede">Authored-dark agreement for the unchanged baseline engine, reported independently by design system. This baseline contains no M2 candidate and is non-gating.</p>
<p class="run-state"><strong>${allClean ? 'Clean snapshots' : 'Includes a dirty development run'}</strong><span>Non-gating baseline</span></p></header>
<section class="summary-cards" aria-label="Per-system evidence cards">${cards}</section>
<ol class="rail" aria-label="Evidence chain">
<li><strong>Source pins</strong><span>${systems.length} system-specific</span></li>
<li><strong>Records</strong><span>${reviewed} reviewed</span></li>
<li><strong>Automatic F</strong><span>${automaticFailures === 0 ? 'Clear · 0' : `Open · ${automaticFailures}`}</span></li>
<li><strong>Reproduction</strong><span>${reproducibility}</span></li></ol>
<section class="run-identity" aria-labelledby="run-identity"><h2 id="run-identity">Run identity</h2>
<p><span>Result SHA-256</span><code>${escapeHtml(report.resultSha256)}</code></p>
<p>The equal-system macro is descriptive only. It cannot offset a regression in another design system.</p></section>
<section aria-labelledby="summary"><h2 id="summary">Per-system metrics</h2>
<div class="table-scroll" role="region" aria-label="Per-system metrics" tabindex="0"><table><caption>Primary endpoint and sentinel state</caption>
<thead><tr><th scope="col">System</th><th scope="col">Split</th><th scope="col">Rows</th><th scope="col">D</th><th scope="col">C</th><th scope="col">R</th><th scope="col">E</th><th scope="col">PairScore</th><th scope="col">I</th><th scope="col">F</th><th scope="col">H3/H2/H1</th></tr></thead>
<tbody>${systemRows}</tbody></table></div></section>
${metricLegend()}
${sections}
</main></body></html>\n`;
}

function systemCard(system: PairedThemeReportSystem): string {
  const failures = system.secondary.hardFailureCount;
  const evidence = system.provenance.worktreeClean
    ? 'Clean snapshot · non-gating baseline'
    : 'Dirty development run · non-gating';
  return `<article class="system-card ${failures === 0 ? 'clear' : 'open'}">
<div class="card-heading"><h2>${escapeHtml(system.system)}</h2><span>${escapeHtml(system.split)}</span></div>
<div class="card-measures"><p><span>PairScore</span><strong>${format(system.primary.pairScore)}<small>/100</small></strong><em>Higher is better</em></p>
<p><span>F · automatic</span><strong>${failures}</strong><em>${failures === 0 ? 'Clear' : 'Hard failure open'}</em></p>
<p><span>H3/H2/H1 · manual</span><strong>Not run</strong><em>Paired-theme evaluation</em></p></div>
<footer>${evidence}</footer></article>`;
}

function systemRow(system: PairedThemeReportSystem): string {
  const failures = system.secondary.hardFailureCount;
  return `<tr><th scope="row">${escapeHtml(system.system)}</th><td>${escapeHtml(system.split)}</td>
<td>${system.counts.reviewedDecisions}</td><td>${format(system.primary.d)}</td>
<td>${format(system.primary.c)}</td><td>${format(system.primary.r)}</td>
<td>${format(system.primary.e)}</td><td>${format(system.primary.pairScore)} /100</td>
<td>Not applicable (baseline only)</td><td>${failures} · ${failures === 0 ? 'clear' : 'open'}</td>
<td>Not run</td></tr>`;
}

function metricLegend(): string {
  return `<section aria-labelledby="legend"><h2 id="legend">Metric legend</h2><dl class="legend">
<div><dt>D</dt><dd>Role-conditioned OKLab color-distance loss · lower is better</dd></div>
<div><dt>C</dt><dd>Contrast-consistency loss · lower is better</dd></div>
<div><dt>R</dt><dd>Authored surface-rank disagreement loss · lower is better</dd></div>
<div><dt>E</dt><dd>Equal-weight composite error of D, C, and R · lower is better</dd></div>
<div><dt>PairScore</dt><dd>100 × (1 − E), reported /100 · higher is better</dd></div>
<div><dt>I</dt><dd>Relative error reduction against baseline · higher is better; not applicable to this baseline-only report</dd></div>
<div><dt>F</dt><dd>Automatic hard-failure count · lower is better; zero is required</dd></div>
<div><dt>H3/H2/H1</dt><dd>Manual destructive, major, and minor regression sentinels · not run in paired-theme evaluation</dd></div></dl></section>`;
}

function systemSection(system: PairedThemeReportSystem): string {
  const findings = system.findings.length === 0
    ? '<p class="finding-clear">Clear: no automatic pair-fixture hard failures.</p>'
    : `<ul class="findings">${system.findings.map((finding) => `<li><code>${escapeHtml(finding.id)}</code> ${escapeHtml(finding.message)}</li>`).join('')}</ul>`;
  return `<section aria-labelledby="system-${escapeHtml(system.system)}"><h2 id="system-${escapeHtml(system.system)}">${escapeHtml(system.system)} evidence</h2>
<div class="metrics"><p><strong>PairScore /100</strong><span>${format(system.primary.pairScore)}</span><small>Higher is better</small></p>
<p><strong>Raw contrast error</strong><span>${format(system.secondary.contrastErrorRaw)}</span><small>Lower is better</small></p>
<p><strong>Rank inversion rate</strong><span>${format(system.secondary.surfaceRankInversionRate)}</span><small>Lower is better</small></p>
<p><strong>Accent hue error</strong><span>${system.secondary.accentHueErrorDegrees === null ? 'N/A' : `${format(system.secondary.accentHueErrorDegrees)}°`}</span><small>Lower is better</small></p></div>
<h3>Automatic hard failures</h3>${findings}
<details><summary>Denominators and row details</summary><p>${system.counts.scenes} scenes · ${system.counts.paintsPerVariant} paints per variant · ${system.counts.observations} observations · ${system.counts.colorRows} D · ${system.counts.contrastRows} C · ${system.counts.rankPairs} R.</p>
<p>Row IDs: ${[...system.rows.color, ...system.rows.contrast, ...system.rows.rank].map((row) => `<code>${escapeHtml(row.id)}</code>`).join(' ')}</p></details>
${provenanceDetails(system.provenance)}</section>`;
}

function provenanceDetails(value: PairedThemeReportProvenance): string {
  const viewport = `${value.viewport.width}×${value.viewport.height} @ ${value.viewport.deviceScaleFactor}×`;
  const rows: readonly [string, string][] = [
    ['System / split', `${value.system} / ${value.split}`],
    ['Evidence state', value.worktreeClean ? 'Clean snapshot · non-gating baseline' : 'Dirty development run · non-gating'],
    ['Evaluator commit', value.evaluatorCommit], ['Protocol', value.protocolId],
    ['Protocol SHA-256', value.protocolSha256], ['M0 manifest SHA-256', value.m0ManifestSha256],
    ['Scene manifest SHA-256', value.sceneManifestSha256], ['Normalized tokens SHA-256', value.normalizedTokensSha256],
    ['Record IDs SHA-256', value.recordIdsSha256], ['Metric payload SHA-256', value.metricPayloadSha256],
    ['Baseline engine commit', value.baselineEngineCommit], ['ROLE_PROFILES source SHA-256', value.roleProfilesSourceSha256],
    ['Metric spec', value.metricSpecId], ['Metric spec SHA-256', value.metricSpecSha256],
    ['Metric freeze commit', value.metricFreezeCommit],
    ['ROLE_PROFILES canonical SHA-256', value.roleProfilesCanonicalSha256],
    ['Source package', `${value.source.name} ${value.source.version}`], ['Source integrity', value.source.integrity],
    ['Source license', value.source.license], ['Source repository', value.source.repository],
    ['Browser', `${value.browser.name} ${value.browser.version}`], ['Node', value.nodeVersion],
    ['Viewport', viewport], ['Locale', value.locale], ['Color profile', value.colorProfile],
  ];
  return `<details class="provenance" open><summary>Complete provenance · ${escapeHtml(value.system)}</summary><dl>${rows.map(([label, content]) => `<div><dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(content)}</code></dd></div>`).join('')}</dl></details>`;
}

function format(value: number): string {
  return value.toFixed(4);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const REPORT_STYLES = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#18202c}main{max-width:1180px;margin:auto;padding:42px 28px 80px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:16px;background:#fff;padding:10px;z-index:2}
header{margin-bottom:22px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:750;color:#496078}.lede{max-width:72ch;font-size:17px;line-height:1.55}
h1{margin:.25em 0;font-size:clamp(32px,5vw,54px);line-height:1.05;letter-spacing:-.035em}h2{margin-top:44px}h3{margin-top:28px}
.run-state{display:flex;gap:10px;align-items:center;font-size:13px}.run-state span,.card-heading span{color:#526174}.run-state span{border-left:1px solid #bbc4cf;padding-left:10px}
.summary-cards{display:flex;gap:14px;overflow-x:auto;padding:2px 2px 10px;scroll-snap-type:x proximity}.system-card{flex:1 0 330px;scroll-snap-align:start;background:#fff;border:1px solid #cfd6df;border-top:5px solid #1769e0;border-radius:12px;padding:16px}.system-card.open{border-top-color:#a13d34}.card-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.card-heading h2{margin:0;font-size:20px}.card-heading span{font-size:12px}.card-measures{display:grid;grid-template-columns:1.15fr .7fr 1.25fr;gap:12px;margin-top:18px}.card-measures p{display:grid;align-content:start;gap:4px;margin:0;min-width:0}.card-measures span,.card-measures em{font-size:11px;color:#5a687a}.card-measures strong{font-size:20px}.card-measures small{font-size:12px;font-weight:500}.card-measures em{font-style:normal}.system-card footer{border-top:1px solid #e0e4ea;margin-top:15px;padding-top:10px;font-size:12px;color:#526174}
.rail{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;padding:0;list-style:none;background:#cdd4dd;border:1px solid #cdd4dd;border-radius:12px;overflow:hidden;margin:30px 0}.rail li{background:#fff;padding:14px;display:grid;gap:5px}.rail span{color:#526174;font-size:13px}
.run-identity{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.8fr);gap:18px;align-items:end}.run-identity h2{grid-column:1/-1;margin-bottom:0}.run-identity p{margin:0;color:#526174}.run-identity p:first-of-type{display:grid;gap:6px}.run-identity code{overflow-wrap:anywhere;color:#18202c}
.table-scroll{overflow:auto;border:1px solid #cfd6df;border-radius:12px;background:#fff}table{border-collapse:collapse;width:100%;min-width:940px}caption{text-align:left;padding:14px;font-weight:700}th,td{padding:12px 14px;border-top:1px solid #e0e4ea;text-align:right}th:first-child,td:first-child{text-align:left}thead th{font-size:12px;color:#526174}
.legend,.provenance dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.legend div,.provenance dl div,.metrics p{background:#fff;border:1px solid #d8dde5;border-radius:10px;padding:13px;margin:0}.legend dt{font-family:ui-monospace,SFMono-Regular,monospace;font-weight:800}.legend dd{margin:4px 0 0;color:#526174;font-size:13px;line-height:1.45}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metrics p{display:grid;gap:6px}.metrics span{font-size:23px;font-weight:750}.metrics small{color:#526174}.finding-clear{border-left:4px solid #1769e0;padding-left:12px}.findings{border-left:4px solid #a13d34;padding-left:28px}
code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.86em}summary{cursor:pointer;font-weight:700}details{background:#fff;border:1px solid #d8dde5;border-radius:10px;padding:14px}.provenance{margin-top:12px}.provenance dl{margin-top:14px}.provenance dt{font-size:11px;color:#5a687a}.provenance dd{margin:5px 0 0;overflow-wrap:anywhere}
:focus-visible{outline:3px solid #1769e0;outline-offset:3px}@media(max-width:760px){.rail,.metrics,.legend,.provenance dl{grid-template-columns:1fr 1fr}.run-identity{grid-template-columns:1fr}}
@media(max-width:520px){main{padding:24px 16px 64px}header{margin-bottom:16px}.eyebrow{margin:0 0 8px}h1{font-size:32px;margin:0 0 10px}.lede{font-size:15px;line-height:1.45;margin:0 0 10px}.run-state{margin:0}.summary-cards{margin-right:-16px}.system-card{flex-basis:calc(100vw - 44px);padding:14px}.card-measures{grid-template-columns:1fr .62fr 1.12fr;gap:8px}.card-measures strong{font-size:18px}.rail,.metrics,.legend,.provenance dl{grid-template-columns:1fr}.rail{margin-top:24px}h2{margin-top:36px}}
@media(prefers-color-scheme:dark){body{background:#101318;color:#edf1f7}.system-card,.rail li,.table-scroll,.legend div,.provenance dl div,.metrics p,details{background:#181d24;border-color:#3a424d}.rail{background:#3a424d;border-color:#3a424d}.run-state span,.card-heading span,.card-measures span,.card-measures em,.system-card footer,.rail span,.run-identity p,.legend dd,.metrics small,.provenance dt,thead th{color:#aeb8c7}.run-identity code{color:#edf1f7}.system-card footer,th,td{border-color:#343b45}}
@media print{:root{color-scheme:only light}*,*::before,*::after{background:#fff!important;color:#000!important;box-shadow:none!important}main{max-width:none;padding:0}.skip{display:none}.summary-cards{display:block;overflow:visible}.system-card{break-inside:avoid;margin-bottom:10px;border:1px solid #777}.rail{border:1px solid #777}.table-scroll{overflow:visible}table{min-width:0;font-size:8.5pt}.provenance{break-inside:avoid}summary{display:none}}
`;
