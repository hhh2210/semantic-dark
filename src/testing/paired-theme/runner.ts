import {execFile as execFileCallback} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {
  prepareScratchOutput,
  serializeCanonicalJson,
  sha256File,
  sha256Text,
  writeCanonicalJson,
  writeJsonLines,
} from '../artifacts';
import {collectPaintObservations} from './collector';
import {evaluatePairedThemeSystem} from './evaluate';
import {materialThemePair, normalizedTokenHash} from './material';
import {buildObservationMatrix, REQUIRED_OBSERVATION_VARIANTS} from './observations';
import {loadPairedThemeProtocol} from './protocol';
import {
  createPairedThemeReport,
  renderPairedThemeReportHtml,
  type PairedThemeReport,
  type PairedThemeReportProvenance,
} from './report';
import {renderPairedThemeDocument} from './render';
import {buildThemeVariantValues} from './variants';
import type {PaintObservation} from './types';

const execFile = promisify(execFileCallback);
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const M0_MANIFEST = 'fixtures/evaluation/m0-manifest.v1.json';

export interface MaterialPairedThemeRunOptions {
  repoRoot?: string;
  protocolPath: string;
  output: string;
  chromePath?: string;
  headless?: boolean;
  requireClean?: boolean;
}

export interface MaterialPairedThemeRunResult {
  report: PairedThemeReport;
  reproducibility: {
    status: 'exact';
    runA: RunIdentity;
    runB: RunIdentity;
  };
}

interface RunIdentity {
  resultSha256: string;
  observationsSha256: string;
  recordIdsSha256: string;
  metricPayloadSha256: string;
  renderSha256: Readonly<Record<string, string>>;
}

interface M0Identity {
  manifestSha256: string;
  baselineEngineCommit: string;
  roleProfilesSourceSha256: string;
  roleProfilesCanonicalSha256: string;
}

/** Execute two independent Chrome launches and require byte-stable Material evidence. */
export async function runMaterialPairedTheme(
  options: MaterialPairedThemeRunOptions,
): Promise<MaterialPairedThemeRunResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const output = await prepareScratchOutput(options.output, 'Paired-theme');
  const loaded = await loadPairedThemeProtocol(path.resolve(repoRoot, options.protocolPath));
  if (loaded.protocol.source.system !== 'material') throw new Error('Material runner requires Material');
  const theme = materialThemePair(loaded.protocol.source);
  const variants = buildThemeVariantValues(theme, loaded.scenes.scenes);
  const git = await gitIdentity(repoRoot);
  const requireClean = options.requireClean !== false;
  if (requireClean && !git.clean) throw new Error('Final paired-theme runs require a clean worktree');
  const m0 = await loadM0Identity(repoRoot);
  const protocolSha256 = await sha256File(loaded.protocolPath);
  const sceneManifestSha256 = await sha256File(loaded.sceneManifestPath);
  const common = {
    repoRoot,
    chromePath: options.chromePath ?? DEFAULT_CHROME,
    headless: options.headless !== false,
    protocolSha256,
    sceneManifestSha256,
    normalizedTokensSha256: normalizedTokenHash(theme),
    evaluatorCommit: git.commit,
    worktreeClean: git.clean,
    m0,
  };
  const runA = await runOnce('run-a', output, loaded, theme.source, variants.values, common);
  const runB = await runOnce('run-b', output, loaded, theme.source, variants.values, common);
  assertExact(runA.identity, runB.identity);
  const finalReport = createPairedThemeReport([runA.evaluation], runA.provenance, {
    status: 'exact',
    comparedResultSha256: runB.report.resultSha256,
  });
  const reproducibility = {status: 'exact' as const, runA: runA.identity, runB: runB.identity};
  await writeCanonicalJson(finalReport, path.join(output, 'metrics.json'));
  await writeFile(path.join(output, 'report.html'), renderPairedThemeReportHtml(finalReport), 'utf8');
  await writeCanonicalJson(reproducibility, path.join(output, 'reproducibility.json'));
  return {report: finalReport, reproducibility};
}

async function runOnce(
  runName: string,
  output: string,
  loaded: Awaited<ReturnType<typeof loadPairedThemeProtocol>>,
  source: PairedThemeReportProvenance['source'],
  values: ReturnType<typeof buildThemeVariantValues>['values'],
  common: {
    repoRoot: string; chromePath: string; headless: boolean; protocolSha256: string;
    sceneManifestSha256: string; normalizedTokensSha256: string; evaluatorCommit: string;
    worktreeClean: boolean; m0: M0Identity;
  },
) {
  const runOutput = path.join(output, runName);
  await mkdir(runOutput, {recursive: true});
  const browser = await chromium.launch({
    executablePath: common.chromePath,
    headless: common.headless,
    args: ['--force-color-profile=srgb'],
  });
  const observations: PaintObservation[] = [];
  const renderSha256: Record<string, string> = {};
  let browserVersion: string;
  try {
    browserVersion = browser.version();
    for (const variant of REQUIRED_OBSERVATION_VARIANTS) {
      const html = renderPairedThemeDocument({
        title: `${loaded.protocol.id} · ${variant}`,
        scenes: loaded.scenes.scenes,
        paintValues: values[variant],
      });
      renderSha256[variant] = sha256Text(html);
      await writeFile(path.join(runOutput, `render-${variant}.html`), html, 'utf8');
      observations.push(...await collectPaintObservations(browser, {
        html,
        system: 'material',
        split: loaded.protocol.split,
        variant,
        scenes: loaded.scenes.scenes,
        viewport: loaded.protocol.viewport,
        locale: loaded.protocol.locale,
      }));
    }
  } finally {
    await browser.close();
  }
  const matrix = buildObservationMatrix({
    system: 'material', split: loaded.protocol.split,
    scenes: loaded.scenes.scenes, observations,
  });
  const evaluation = evaluatePairedThemeSystem(matrix, loaded.scenes.scenes, loaded.protocol.metric);
  assertMaterialDenominators(evaluation.counts);
  const recordIds = [...evaluation.rows.color, ...evaluation.rows.contrast, ...evaluation.rows.rank]
    .map((row) => row.id).sort();
  const recordIdsSha256 = sha256Text(serializeCanonicalJson(recordIds));
  const metricPayloadSha256 = sha256Text(serializeCanonicalJson(evaluation));
  const observationsSha256 = sha256Text(serializeCanonicalJson(observations));
  const provenance: PairedThemeReportProvenance = {
    evaluatorCommit: common.evaluatorCommit,
    worktreeClean: common.worktreeClean,
    protocolId: loaded.protocol.id,
    protocolSha256: common.protocolSha256,
    m0ManifestSha256: common.m0.manifestSha256,
    sceneManifestSha256: common.sceneManifestSha256,
    normalizedTokensSha256: common.normalizedTokensSha256,
    recordIdsSha256,
    metricPayloadSha256,
    baselineEngineCommit: common.m0.baselineEngineCommit,
    roleProfilesSourceSha256: common.m0.roleProfilesSourceSha256,
    roleProfilesCanonicalSha256: common.m0.roleProfilesCanonicalSha256,
    source,
    browser: {name: 'Google Chrome', version: browserVersion},
    nodeVersion: process.version,
    viewport: loaded.protocol.viewport,
    locale: loaded.protocol.locale,
    colorProfile: loaded.protocol.colorProfile,
  };
  const report = createPairedThemeReport([evaluation], provenance);
  const identity: RunIdentity = {
    resultSha256: report.resultSha256,
    observationsSha256,
    recordIdsSha256,
    metricPayloadSha256,
    renderSha256: sortRecord(renderSha256),
  };
  await writeJsonLines(observations, path.join(runOutput, 'observations.jsonl'), true);
  await writeCanonicalJson(evaluation.rows, path.join(runOutput, 'metric-inputs.json'));
  await writeCanonicalJson(report, path.join(runOutput, 'metrics.json'));
  await writeFile(path.join(runOutput, 'report.html'), renderPairedThemeReportHtml(report), 'utf8');
  await writeCanonicalJson(identity, path.join(runOutput, 'run-identity.json'));
  return {evaluation, provenance, report, identity};
}

async function loadM0Identity(repoRoot: string): Promise<M0Identity> {
  const manifestPath = path.join(repoRoot, M0_MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    baseline: {commit: string};
    role_profiles: {source: string; source_sha256: string; canonical_sha256: string};
  };
  const actualSourceSha256 = await sha256File(path.join(repoRoot, manifest.role_profiles.source));
  if (actualSourceSha256 !== manifest.role_profiles.source_sha256) {
    throw new Error('Frozen ROLE_PROFILES source hash no longer matches M0');
  }
  return {
    manifestSha256: await sha256File(manifestPath),
    baselineEngineCommit: manifest.baseline.commit,
    roleProfilesSourceSha256: manifest.role_profiles.source_sha256,
    roleProfilesCanonicalSha256: manifest.role_profiles.canonical_sha256,
  };
}

async function gitIdentity(repoRoot: string): Promise<{commit: string; clean: boolean}> {
  const [{stdout: commit}, {stdout: status}] = await Promise.all([
    execFile('git', ['rev-parse', 'HEAD'], {cwd: repoRoot}),
    execFile('git', ['status', '--porcelain'], {cwd: repoRoot}),
  ]);
  return {commit: commit.trim(), clean: status.trim().length === 0};
}

function assertMaterialDenominators(counts: {scenes: number; paintsPerVariant: number;
  observations: number; reviewedDecisions: number; colorRows: number;
  contrastRows: number; rankPairs: number}): void {
  const actual = [counts.scenes, counts.paintsPerVariant, counts.observations,
    counts.reviewedDecisions, counts.colorRows, counts.contrastRows, counts.rankPairs];
  const expected = [4, 15, 45, 10, 10, 6, 3];
  if (actual.some((value, index) => value !== expected[index])) {
    throw new Error(`Material denominator mismatch: ${actual.join('/')}`);
  }
}

function assertExact(left: RunIdentity, right: RunIdentity): void {
  if (serializeCanonicalJson(left) !== serializeCanonicalJson(right)) {
    throw new Error('Independent paired-theme runs are not exactly reproducible');
  }
}

function sortRecord(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
