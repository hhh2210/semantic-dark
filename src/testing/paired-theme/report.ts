import {serializeCanonicalJson, sha256Text} from '../artifacts';
import type {PairedThemeSystemEvaluation} from './evaluation-types';
import type {PackagePin, PairedThemeProtocol} from './types';

export interface PairedThemeReportProvenance {
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
  roleProfilesSourceSha256: string;
  roleProfilesCanonicalSha256: string;
  source: PackagePin;
  browser: {name: 'Google Chrome'; version: string};
  nodeVersion: string;
  viewport: PairedThemeProtocol['viewport'];
  locale: string;
  colorProfile: 'srgb';
}

export interface PairedThemeReportResult {
  schema: 'semantic-dark.paired-theme-report-result.v1';
  provenance: PairedThemeReportProvenance;
  systems: readonly PairedThemeSystemEvaluation[];
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
  evaluations: readonly PairedThemeSystemEvaluation[],
  provenance: PairedThemeReportProvenance,
  reproducibility: PairedThemeReport['reproducibility'] = {
    status: 'not-compared',
    comparedResultSha256: null,
  },
): PairedThemeReport {
  if (evaluations.length === 0) throw new Error('At least one system evaluation is required');
  const systems = [...evaluations].sort((left, right) => compare(left.system, right.system));
  const identities = new Set<string>();
  for (const system of systems) {
    if (identities.has(system.system)) throw new Error(`Duplicate system result: ${system.system}`);
    identities.add(system.system);
  }
  const result: PairedThemeReportResult = {
    schema: 'semantic-dark.paired-theme-report-result.v1',
    provenance,
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
  const provenance = report.result.provenance;
  const systemRows = report.result.systems.map((system) => `<tr>
<th scope="row">${escapeHtml(system.system)}</th><td>${escapeHtml(system.split)}</td>
<td>${system.counts.reviewedDecisions}</td><td>${format(system.primary.d)}</td>
<td>${format(system.primary.c)}</td><td>${format(system.primary.r)}</td>
<td>${format(system.primary.e)}</td><td>${format(system.primary.pairScore)}</td>
<td>Not applicable (baseline only)</td><td>${system.secondary.hardFailureCount}</td>
<td>Not run</td></tr>`).join('');
  const sections = report.result.systems.map(systemSection).join('');
  const reproducibility = report.reproducibility.status === 'exact' ? 'Exact' : 'Not compared';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Semantic Dark paired-theme evidence</title><style>${REPORT_STYLES}</style></head>
<body><a class="skip" href="#main">Skip to evidence</a><main id="main">
<header><p class="eyebrow">Semantic Dark · M1 evidence ledger</p><h1>Paired-theme baseline report</h1>
<p class="lede">Per-system authored dark agreement for the unchanged baseline engine. No M2 candidate is present, so relative improvement is intentionally not applicable.</p></header>
<ol class="rail" aria-label="Evidence chain">
<li><strong>Source pin</strong><span>${escapeHtml(provenance.source.name)} ${escapeHtml(provenance.source.version)}</span></li>
<li><strong>Records</strong><span>${report.result.systems.reduce((sum, item) => sum + item.counts.reviewedDecisions, 0)} reviewed</span></li>
<li><strong>Metrics</strong><span>Per system</span></li>
<li><strong>Reproduction</strong><span>${reproducibility}</span></li></ol>
<section aria-labelledby="provenance"><h2 id="provenance">Provenance</h2><dl>
<div><dt>Evaluator commit</dt><dd><code>${escapeHtml(provenance.evaluatorCommit)}</code></dd></div>
<div><dt>Worktree</dt><dd>${provenance.worktreeClean ? 'Clean' : 'Dirty (development run)'}</dd></div>
<div><dt>Protocol</dt><dd>${escapeHtml(provenance.protocolId)} · <code>${escapeHtml(provenance.protocolSha256)}</code></dd></div>
<div><dt>Baseline engine</dt><dd><code>${escapeHtml(provenance.baselineEngineCommit)}</code></dd></div>
<div><dt>Browser</dt><dd>${escapeHtml(provenance.browser.name)} ${escapeHtml(provenance.browser.version)}</dd></div>
<div><dt>Result SHA-256</dt><dd><code>${escapeHtml(report.resultSha256)}</code></dd></div></dl></section>
<section aria-labelledby="summary"><h2 id="summary">Per-system summary</h2>
<div class="table-scroll" role="region" aria-label="Per-system metrics" tabindex="0"><table><caption>Primary endpoint and sentinel state</caption>
<thead><tr><th scope="col">System</th><th scope="col">Split</th><th scope="col">Rows</th><th scope="col">D</th><th scope="col">C</th><th scope="col">R</th><th scope="col">E</th><th scope="col">PairScore</th><th scope="col">I</th><th scope="col">F</th><th scope="col">H3/H2/H1</th></tr></thead>
<tbody>${systemRows}</tbody></table></div><p class="note">The equal-system macro is descriptive only and cannot offset a regression in another design system.</p></section>
${sections}
</main></body></html>\n`;
}

function systemSection(system: PairedThemeSystemEvaluation): string {
  const findings = system.findings.length === 0
    ? '<p>No automatic pair-fixture failures.</p>'
    : `<ul>${system.findings.map((finding) => `<li><code>${escapeHtml(finding.id)}</code> ${escapeHtml(finding.message)}</li>`).join('')}</ul>`;
  return `<section aria-labelledby="system-${escapeHtml(system.system)}"><h2 id="system-${escapeHtml(system.system)}">${escapeHtml(system.system)}</h2>
<div class="metrics"><p><strong>PairScore</strong><span>${format(system.primary.pairScore)}</span></p>
<p><strong>Raw contrast error</strong><span>${format(system.secondary.contrastErrorRaw)}</span></p>
<p><strong>Rank inversion rate</strong><span>${format(system.secondary.surfaceRankInversionRate)}</span></p>
<p><strong>Accent hue error</strong><span>${system.secondary.accentHueErrorDegrees === null ? 'N/A' : `${format(system.secondary.accentHueErrorDegrees)}°`}</span></p></div>
<h3>Automatic findings</h3>${findings}
<details><summary>Denominators and row details</summary><p>${system.counts.scenes} scenes · ${system.counts.paintsPerVariant} paints per variant · ${system.counts.observations} observations · ${system.counts.colorRows} D · ${system.counts.contrastRows} C · ${system.counts.rankPairs} R.</p>
<p>Row IDs: ${[...system.rows.color, ...system.rows.contrast, ...system.rows.rank].map((row) => `<code>${escapeHtml(row.id)}</code>`).join(' ')}</p></details></section>`;
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
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#18202c}main{max-width:1180px;margin:auto;padding:48px 28px 80px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:16px;background:#fff;padding:10px;z-index:2}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700;color:#496078}.lede{max-width:72ch;font-size:18px;line-height:1.6}
h1{font-size:clamp(32px,5vw,54px);line-height:1.05;letter-spacing:-.035em}h2{margin-top:48px}h3{margin-top:28px}
.rail{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;padding:0;list-style:none;background:#cdd4dd;border:1px solid #cdd4dd;border-radius:14px;overflow:hidden;margin:36px 0}
.rail li{background:#fff;padding:16px;display:grid;gap:5px}.rail span{color:#526174;font-size:13px}
dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}dl div,.metrics p{background:#fff;border:1px solid #d8dde5;border-radius:12px;padding:14px;margin:0}dt{font-size:12px;color:#5a687a}dd{margin:6px 0 0;overflow-wrap:anywhere}
.table-scroll{overflow:auto;border:1px solid #cfd6df;border-radius:14px;background:#fff}table{border-collapse:collapse;width:100%;min-width:900px}caption{text-align:left;padding:14px;font-weight:700}th,td{padding:12px 14px;border-top:1px solid #e0e4ea;text-align:right}th:first-child,td:first-child{text-align:left}thead th{font-size:12px;color:#526174}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metrics p{display:grid;gap:8px}.metrics span{font-size:24px;font-weight:700}
code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.88em}.note{color:#526174}summary{cursor:pointer;font-weight:700}details{background:#fff;border:1px solid #d8dde5;border-radius:12px;padding:14px}
:focus-visible{outline:3px solid #1769e0;outline-offset:3px}@media(max-width:760px){.rail,.metrics,dl{grid-template-columns:1fr 1fr}}@media(max-width:520px){.rail,.metrics,dl{grid-template-columns:1fr}}@media(prefers-color-scheme:dark){body{background:#101318;color:#edf1f7}.rail{background:#3a424d;border-color:#3a424d}.rail li,dl div,.metrics p,.table-scroll,details{background:#181d24;border-color:#3a424d}.rail span,dt,.note,thead th{color:#aeb8c7}th,td{border-color:#343b45}}
@media print{body{background:#fff;color:#000}main{padding:0}.rail li,dl div,.metrics p,.table-scroll,details{border-color:#888}}
`;
