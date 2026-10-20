import path from 'node:path';

import {validateM0V2EvidenceCompletion} from './m0-evidence-completion';
import {verifyM0V2ExternalArtifact} from './m0-repository';
import {assertM0V2JsonSchema} from './m0-schema';
import {
  M0_V2_COMPLETION_SCHEMA_PATH,
  type M0V2EvidenceCompletion,
  type M0V2EvidenceLabel,
  type M0V2EvidenceReference,
  type M0V2Manifest,
} from './m0-types';

export interface VerifiedM0V2Evidence {
  reference: Readonly<M0V2EvidenceReference>;
  completionPath: string;
  logPath: string;
  completion: Readonly<M0V2EvidenceCompletion>;
}

export async function verifyM0V2EvidencePair(
  repoRoot: string,
  evidenceRoot: string,
  document: Readonly<M0V2Manifest>,
): Promise<{verify: VerifiedM0V2Evidence; e2e: VerifiedM0V2Evidence}> {
  const [verify, e2e] = await Promise.all([
    verifyEvidence(repoRoot, evidenceRoot, document, 'verify'),
    verifyEvidence(repoRoot, evidenceRoot, document, 'e2e'),
  ]);
  if (verify.reference.id === e2e.reference.id ||
      verify.completionPath === e2e.completionPath || verify.logPath === e2e.logPath) {
    throw new Error('M0-v2 verify and e2e evidence must have distinct immutable identities');
  }
  assertSharedEnvironment(document, verify.completion, e2e.completion);
  if (document.recordedAt < verify.completion.completedAt ||
      document.recordedAt < e2e.completion.completedAt) {
    throw new Error('M0-v2 manifest was recorded before its evidence completed');
  }
  return {verify, e2e};
}

async function verifyEvidence(
  repoRoot: string,
  evidenceRoot: string,
  document: Readonly<M0V2Manifest>,
  label: M0V2EvidenceLabel,
): Promise<VerifiedM0V2Evidence> {
  const reference = document.evidence[label];
  const completionArtifact = await verifyM0V2ExternalArtifact(
    evidenceRoot,
    reference.completion,
    `${label} evidence completion`,
    `completion.${label}.${reference.id}.json`,
  );
  let parsed: unknown;
  try { parsed = JSON.parse(completionArtifact.bytes.toString('utf8')) as unknown; } catch (error) {
    throw new Error(`M0-v2 ${label} completion is invalid JSON`, {cause: error});
  }
  await assertM0V2JsonSchema(path.join(repoRoot, M0_V2_COMPLETION_SCHEMA_PATH),
    parsed, `M0-v2 ${label} completion`);
  const completion = validateM0V2EvidenceCompletion(parsed);
  if (completion.id !== reference.id || completion.command !== reference.command) {
    throw new Error(`M0-v2 ${label} completion identity differs from the manifest reference`);
  }
  if (completion.cwd !== repoRoot || completion.git.head !== document.commits.evaluator ||
      completion.git.tree !== document.implementationPins.evaluatorTreeSha1) {
    throw new Error(`M0-v2 ${label} completion did not run at the frozen evaluator tree`);
  }
  if (completion.outcome.status !== 'passed' || completion.outcome.exitCode !== 0 ||
      completion.outcome.signal !== null || !completion.git.cleanBefore || !completion.git.cleanAfter) {
    throw new Error(`M0-v2 ${label} completion does not prove a successful clean-tree run`);
  }
  const log = await verifyM0V2ExternalArtifact(
    evidenceRoot,
    completion.log,
    `${label} evidence log`,
    `${label}.${reference.id}.log`,
  );
  return {reference, completionPath: completionArtifact.resolvedPath,
    logPath: log.resolvedPath, completion};
}

function assertSharedEnvironment(
  document: Readonly<M0V2Manifest>,
  verify: Readonly<M0V2EvidenceCompletion>,
  e2e: Readonly<M0V2EvidenceCompletion>,
): void {
  for (const key of ['node', 'pnpm', 'git'] as const) {
    if (verify.tools[key].path !== e2e.tools[key].path ||
        verify.tools[key].version !== e2e.tools[key].version) {
      throw new Error(`M0-v2 verify/e2e ${key} identities differ`);
    }
  }
  for (const key of ['HOME', 'PATH', 'TMPDIR', 'CI', 'FORCE_COLOR', 'LANG',
    'LC_ALL', 'TZ'] as const) {
    if (verify.env[key] !== e2e.env[key]) {
      throw new Error(`M0-v2 verify/e2e environment differs at ${key}`);
    }
  }
  for (const key of ['platform', 'architecture', 'osRelease'] as const) {
    if (verify.runtime[key] !== e2e.runtime[key] ||
        verify.runtime[key] !== document.environment[key]) {
      throw new Error(`M0-v2 runtime provenance differs at ${key}`);
    }
  }
  if (verify.tools.node.version !== document.environment.nodeVersion ||
      verify.tools.pnpm.version !== document.environment.pnpmVersion ||
      e2e.tools.chrome?.version !== document.environment.chromeVersion) {
    throw new Error('M0-v2 manifest tool versions differ from runner completions');
  }
  if (verify.tools.chrome !== null || verify.env.CHROME_PATH !== null ||
      e2e.tools.chrome === null || e2e.env.CHROME_PATH !== e2e.tools.chrome.path) {
    throw new Error('M0-v2 Chrome provenance is not command-scoped correctly');
  }
}
