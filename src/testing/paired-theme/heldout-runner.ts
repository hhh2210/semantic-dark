import {execFile as execFileCallback} from 'node:child_process';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {
  resolveScratchOutput,
  writeCanonicalJson,
} from '../artifacts';
import {
  withHeldOutExposureReceipt,
  type ExposureClaim,
} from './metric-freeze';
import {loadPairedThemeProtocol} from './protocol';
import {
  createPairedThemeReport,
  renderPairedThemeReportHtml,
  type PairedThemeReport,
  type PairedThemeReportInput,
} from './report';
import {runPairedTheme, type PairedThemeRunResult} from './runner';

const execFile = promisify(execFileCallback);
const METRIC_SPEC = 'fixtures/evaluation/metric-spec.v1.json';
const HELD_OUT_PROTOCOLS = [
  'fixtures/paired-theme/carbon-v1.protocol.json',
  'fixtures/paired-theme/fluent-v1.protocol.json',
] as const;
const FROZEN_BLOBS = [METRIC_SPEC, ...HELD_OUT_PROTOCOLS] as const;

export interface HeldOutRunOptions {
  repoRoot?: string;
  output: string;
  metricFreezeCommit: string;
  chromePath?: string;
  headless?: boolean;
}

export interface HeldOutRunResult {
  report: PairedThemeReport;
  receipt: ExposureClaim;
  componentRuns: Readonly<Record<'carbon' | 'fluent', PairedThemeRunResult>>;
}

/** Consume the sole Carbon+Fluent exposure and reveal results only after both complete. */
export async function runHeldOutEvaluation(options: HeldOutRunOptions): Promise<HeldOutRunResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const output = resolveScratchOutput(options.output, 'Held-out paired-theme');
  await assertEmptyOutput(output);
  await verifyFreezeBoundary(repoRoot, options.metricFreezeCommit, FROZEN_BLOBS);

  const loaded = await Promise.all(HELD_OUT_PROTOCOLS.map((protocol) =>
    loadPairedThemeProtocol(path.join(repoRoot, protocol), repoRoot),
  ));
  const carbonProtocol = loaded[0]!;
  const fluentProtocol = loaded[1]!;
  if (carbonProtocol.protocol.source.system !== 'carbon' ||
      fluentProtocol.protocol.source.system !== 'fluent' ||
      loaded.some((item) => item.protocol.split !== 'held-out') ||
      carbonProtocol.metricSpecSha256 !== fluentProtocol.metricSpecSha256) {
    throw new Error('Held-out protocols do not form the frozen Carbon/Fluent pair');
  }
  const metricSpecSha256 = carbonProtocol.metricSpecSha256;
  return withHeldOutExposureReceipt(
    carbonProtocol.metricSpec,
    metricSpecSha256,
    options.metricFreezeCommit,
    async (receipt) => {
      const common = {
        repoRoot, requireClean: true, metricFreezeCommit: options.metricFreezeCommit,
        heldOutClaim: receipt, headless: options.headless !== false,
        ...(options.chromePath ? {chromePath: options.chromePath} : {}),
      };
      const carbon = await runPairedTheme({
        ...common, protocolPath: HELD_OUT_PROTOCOLS[0], output: path.join(output, 'carbon'),
      });
      const fluent = await runPairedTheme({
        ...common, protocolPath: HELD_OUT_PROTOCOLS[1], output: path.join(output, 'fluent'),
      });
      const inputs = [carbon, fluent].map(reportInput);
      const draft = createPairedThemeReport(inputs);
      const report = createPairedThemeReport(inputs, {
        status: 'exact', comparedResultSha256: draft.resultSha256,
      });
      await mkdir(output, {recursive: true});
      await writeCanonicalJson(report, path.join(output, 'metrics.json'));
      await writeFile(path.join(output, 'report.html'), renderPairedThemeReportHtml(report), 'utf8');
      await writeCanonicalJson({
        schema: 'semantic-dark.held-out-reproducibility.v1', status: 'exact',
        componentResultSha256: {
          carbon: carbon.report.resultSha256, fluent: fluent.report.resultSha256,
        },
      }, path.join(output, 'reproducibility.json'));
      return {report, receipt, componentRuns: {carbon, fluent}};
    },
  );
}

/** Verify cleanliness, ancestry, and exact frozen blobs before claiming exposure. */
export async function verifyFreezeBoundary(
  repoRootValue: string,
  freezeCommit: string,
  frozenBlobs: readonly string[] = FROZEN_BLOBS,
): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(freezeCommit)) throw new Error('Freeze commit must be a full SHA');
  const repoRoot = path.resolve(repoRootValue);
  const {stdout: status} = await execFile('git', ['status', '--porcelain'], {cwd: repoRoot});
  if (status.trim()) throw new Error('Held-out evaluation requires a clean worktree');
  try {
    await execFile('git', ['merge-base', '--is-ancestor', freezeCommit, 'HEAD'], {cwd: repoRoot});
  } catch {
    throw new Error('Metric freeze commit is not an ancestor of HEAD');
  }
  for (const relative of frozenBlobs) {
    const current = await readFile(path.join(repoRoot, relative), 'utf8');
    const {stdout: frozen} = await execFile('git', ['show', `${freezeCommit}:${relative}`], {
      cwd: repoRoot, maxBuffer: 4 * 1024 * 1024,
    });
    if (current !== frozen) throw new Error(`Frozen blob differs from ${freezeCommit}: ${relative}`);
  }
}

function reportInput(run: PairedThemeRunResult): PairedThemeReportInput {
  const system = run.report.result.systems[0];
  if (!system || run.report.result.systems.length !== 1) {
    throw new Error('Component paired-theme run must contain exactly one system');
  }
  const {provenance, ...evaluation} = system;
  return {evaluation, provenance};
}

async function assertEmptyOutput(output: string): Promise<void> {
  await mkdir(output, {recursive: true});
  if ((await readdir(output)).length !== 0) {
    throw new Error(`Held-out output must be empty before exposure: ${output}`);
  }
}
