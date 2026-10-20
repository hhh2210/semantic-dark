import {serializeCanonicalJson} from '../../artifacts';
import path from 'node:path';
import {
  M0_V1_MANIFEST_PATH,
  M0_V1_MANIFEST_SHA256,
  M0_V2_A3_EXPECTED,
  M0_V2_BASELINE_PROFILE_PATH,
  M0_V2_ENGINE_INTERVENTION_COMMIT,
  type M0V2ArtifactPin,
  type M0V2EvidenceCommand,
  type M0V2EvidenceReference,
  type M0V2Manifest,
  type M0V2PinClosureEntry,
  type M0V2Viewport,
} from './m0-types';
import {
  canonicalTimestamp,
  deepFreeze,
  exactKeys,
  literal,
  match,
  nonEmpty,
  object,
  positiveInteger,
  sha1Digest,
  sha256Digest,
  UUID_V4_PATTERN,
} from './m0-validation-primitives';

const BASELINE_FILE_SHA256 =
  '0b7e66c6bc2281e3387fe5a9df6d57a62fcecb5f7948d39e224f99850d105f5f';
const BASELINE_SEMANTIC_SHA256 =
  'e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5';

export function readM0V2EvaluatorCommit(value: unknown): string {
  const input = object(value, 'M0-v2 manifest');
  const commits = object(input.commits, 'commits');
  return sha1Digest(commits.evaluator, 'commits.evaluator');
}

export function validateM0V2Manifest(
  value: unknown,
  closure: readonly M0V2PinClosureEntry[],
): Readonly<M0V2Manifest> {
  const input = object(value, 'M0-v2 manifest');
  exactKeys(input, ['$schema', 'schema', 'id', 'status', 'recordedAt', 'predecessor',
    'baselineProfile', 'commits', 'implementationPins', 'evidence', 'environment', 'a3'],
  'M0-v2 manifest');
  literal(input.$schema, './m0-manifest.v2.schema.json', '$schema');
  literal(input.schema, 'semantic-dark.m0-manifest.v2', 'schema');
  literal(input.id, 'semantic-dark.m0-v2-baseline', 'id');
  literal(input.status, 'frozen', 'status');
  const predecessor = fixedObject(input.predecessor, 'predecessor', {
    schema: 'semantic-dark.m0-manifest.v1',
    path: M0_V1_MANIFEST_PATH,
    sha256: M0_V1_MANIFEST_SHA256,
  } as const);
  const baselineProfile = fixedObject(input.baselineProfile, 'baselineProfile', {
    path: M0_V2_BASELINE_PROFILE_PATH,
    fileSha256: BASELINE_FILE_SHA256,
    semanticSha256: BASELINE_SEMANTIC_SHA256,
  } as const);
  const commitsInput = object(input.commits, 'commits');
  exactKeys(commitsInput, ['engineIntervention', 'evaluator'], 'commits');
  literal(commitsInput.engineIntervention, M0_V2_ENGINE_INTERVENTION_COMMIT,
    'commits.engineIntervention');
  const commits = {
    engineIntervention: M0_V2_ENGINE_INTERVENTION_COMMIT,
    evaluator: sha1Digest(commitsInput.evaluator, 'commits.evaluator'),
  };
  const implementationPins = validateImplementationPins(input.implementationPins, closure);
  const evidenceInput = object(input.evidence, 'evidence');
  exactKeys(evidenceInput, ['verify', 'e2e'], 'evidence');
  const environment = validateEnvironment(input.environment);
  const a3 = validateA3(input.a3);
  return deepFreeze({
    $schema: './m0-manifest.v2.schema.json',
    schema: 'semantic-dark.m0-manifest.v2',
    id: 'semantic-dark.m0-v2-baseline',
    status: 'frozen',
    recordedAt: canonicalTimestamp(input.recordedAt, 'recordedAt'),
    predecessor,
    baselineProfile,
    commits,
    implementationPins,
    evidence: {
      verify: evidenceReference(evidenceInput.verify, 'verify', 'pnpm verify'),
      e2e: evidenceReference(evidenceInput.e2e, 'e2e', 'pnpm e2e'),
    },
    environment,
    a3,
  });
}

function validateImplementationPins(
  value: unknown,
  closure: readonly M0V2PinClosureEntry[],
): M0V2Manifest['implementationPins'] {
  const input = object(value, 'implementationPins');
  exactKeys(input, ['evaluatorTreeSha1', 'pinSetSha256', 'files'], 'implementationPins');
  if (!Array.isArray(input.files) || input.files.length !== closure.length) {
    throw new Error(`implementationPins.files must contain the exact ${closure.length}-file closure`);
  }
  const files = input.files.map((value, index) => {
    const pin = object(value, `implementationPins.files[${index}]`);
    exactKeys(pin, ['path', 'commitRole', 'sha256'], `implementationPins.files[${index}]`);
    const expected = closure[index]!;
    literal(pin.path, expected.path, `implementationPins.files[${index}].path`);
    literal(pin.commitRole, expected.commitRole, `implementationPins.files[${index}].commitRole`);
    return {path: expected.path, commitRole: expected.commitRole,
      sha256: sha256Digest(pin.sha256, `implementationPins.files[${index}].sha256`)};
  });
  return {
    evaluatorTreeSha1: sha1Digest(input.evaluatorTreeSha1,
      'implementationPins.evaluatorTreeSha1'),
    pinSetSha256: sha256Digest(input.pinSetSha256, 'implementationPins.pinSetSha256'),
    files,
  };
}

function evidenceReference(
  value: unknown,
  label: 'verify' | 'e2e',
  command: M0V2EvidenceCommand,
): M0V2EvidenceReference {
  const input = object(value, `evidence.${label}`);
  exactKeys(input, ['id', 'command', 'completion'], `evidence.${label}`);
  literal(input.command, command, `evidence.${label}.command`);
  return {
    id: match(input.id, UUID_V4_PATTERN, `evidence.${label}.id`),
    command,
    completion: artifactPin(input.completion, `evidence.${label}.completion`),
  };
}

function validateEnvironment(value: unknown): M0V2Manifest['environment'] {
  const input = object(value, 'environment');
  exactKeys(input, ['platform', 'architecture', 'osRelease', 'nodeVersion', 'pnpmVersion',
    'chromeVersion', 'headless', 'locale', 'colorProfile', 'renderViewport',
    'a3ProbeViewport'], 'environment');
  return {
    platform: nonEmpty(input.platform, 'environment.platform'),
    architecture: nonEmpty(input.architecture, 'environment.architecture'),
    osRelease: nonEmpty(input.osRelease, 'environment.osRelease'),
    nodeVersion: nonEmpty(input.nodeVersion, 'environment.nodeVersion'),
    pnpmVersion: nonEmpty(input.pnpmVersion, 'environment.pnpmVersion'),
    chromeVersion: nonEmpty(input.chromeVersion, 'environment.chromeVersion'),
    headless: literal(input.headless, true, 'environment.headless'),
    locale: literal(input.locale, 'en-US', 'environment.locale'),
    colorProfile: literal(input.colorProfile, 'srgb', 'environment.colorProfile'),
    renderViewport: viewport(input.renderViewport, 'renderViewport', 1280, 900),
    a3ProbeViewport: viewport(input.a3ProbeViewport, 'a3ProbeViewport', 220, 100),
  };
}

function validateA3(value: unknown): M0V2Manifest['a3'] {
  const input = object(value, 'a3');
  exactKeys(input, ['caseId', 'stages', 'diagnosis', 'correctedRender',
    'evaluatorTolerance', 'artifacts'], 'a3');
  const actualExpected = {
    caseId: input.caseId,
    stages: input.stages,
    diagnosis: input.diagnosis,
    correctedRender: input.correctedRender,
    evaluatorTolerance: input.evaluatorTolerance,
  };
  if (serializeCanonicalJson(actualExpected) !== serializeCanonicalJson(M0_V2_A3_EXPECTED)) {
    throw new Error('M0-v2 A3 measurements differ from the frozen RGBA8 intervention evidence');
  }
  const artifacts = object(input.artifacts, 'a3.artifacts');
  exactKeys(artifacts, ['source', 'result', 'screenshot'], 'a3.artifacts');
  return {...M0_V2_A3_EXPECTED, artifacts: {
    source: artifactPin(artifacts.source, 'a3.artifacts.source'),
    result: artifactPin(artifacts.result, 'a3.artifacts.result'),
    screenshot: artifactPin(artifacts.screenshot, 'a3.artifacts.screenshot'),
  }};
}

function artifactPin(value: unknown, label: string): M0V2ArtifactPin {
  const input = object(value, label);
  exactKeys(input, ['path', 'byteLength', 'sha256'], label);
  const artifactPath = nonEmpty(input.path, `${label}.path`);
  if (!path.isAbsolute(artifactPath)) throw new Error(`${label}.path must be absolute`);
  return {path: artifactPath,
    byteLength: positiveInteger(input.byteLength, `${label}.byteLength`),
    sha256: sha256Digest(input.sha256, `${label}.sha256`)};
}

function viewport(
  value: unknown, label: string, width: number, height: number,
): M0V2Viewport {
  const input = object(value, label);
  exactKeys(input, ['width', 'height', 'deviceScaleFactor'], label);
  literal(input.width, width, `${label}.width`);
  literal(input.height, height, `${label}.height`);
  literal(input.deviceScaleFactor, 1, `${label}.deviceScaleFactor`);
  return {width, height, deviceScaleFactor: 1};
}

function fixedObject<T extends Record<string, string>>(
  value: unknown, label: string, expected: T,
): T {
  const input = object(value, label);
  exactKeys(input, Object.keys(expected), label);
  for (const [key, wanted] of Object.entries(expected)) {
    literal(input[key], wanted, `${label}.${key}`);
  }
  return expected;
}
