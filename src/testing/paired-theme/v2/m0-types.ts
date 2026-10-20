export const M0_V2_MANIFEST_PATH = 'fixtures/evaluation/m0-manifest.v2.json';
export const M0_V2_MANIFEST_SCHEMA_PATH =
  'fixtures/evaluation/m0-manifest.v2.schema.json';
export const M0_V2_COMPLETION_SCHEMA_PATH =
  'fixtures/evaluation/m0-evidence-completion.v2.schema.json';
export const M0_V1_MANIFEST_PATH = 'fixtures/evaluation/m0-manifest.v1.json';
export const M0_V1_MANIFEST_SHA256 =
  '69efa054f742c58b7c69e6d64bca51e04e67ef730ac67ac980a3ddff854bb205';
export const M0_V2_ENGINE_INTERVENTION_COMMIT =
  '6952eab475b6deb45e5558e0c1e764154f42a916';
export const M0_V2_BASELINE_PROFILE_PATH =
  'fixtures/profiles/baseline-profile.v2.json';

export const M0_V2_A3_EXPECTED = Object.freeze({
  caseId: 'spectrum.surface.card-to-raised.rgba8-boundary' as const,
  stages: Object.freeze({
    mapperInMemory: 1.120999900000913,
    cssSerialized: 1.1209998518368234,
    chromeComputedStyle: 1.1199500334856427,
    afterBackdropCompositing: 1.1199500334856427,
  }),
  diagnosis: 'real-rendered-rgba8-shortfall-engine-intervention' as const,
  correctedRender: Object.freeze({
    foregroundRgba8: Object.freeze([42, 41, 41, 255] as const),
    backdropRgba8: Object.freeze([32, 32, 32, 255] as const),
    contrast: 1.123181338925729,
  }),
  evaluatorTolerance: 0 as const,
});

/** Kept as an alias for callers written against the first M0-v2 draft. */
export const M0_V2_A3_EVIDENCE = M0_V2_A3_EXPECTED;

export type M0V2CommitRole = 'engine' | 'evaluator';
export type M0V2EvidenceCommand = 'pnpm verify' | 'pnpm e2e';
export type M0V2EvidenceLabel = 'verify' | 'e2e';

export interface M0V2PinClosureEntry {
  path: string;
  commitRole: M0V2CommitRole;
}

export interface M0V2ImplementationPin extends M0V2PinClosureEntry {
  sha256: string;
}

export interface M0V2ArtifactPin {
  path: string;
  byteLength: number;
  sha256: string;
}

export interface M0V2EvidenceReference {
  id: string;
  command: M0V2EvidenceCommand;
  completion: M0V2ArtifactPin;
}

export interface M0V2Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export type M0V2A3Evidence = typeof M0_V2_A3_EXPECTED & {
  artifacts: {
    source: M0V2ArtifactPin;
    result: M0V2ArtifactPin;
    screenshot: M0V2ArtifactPin;
  };
};

export interface M0V2Manifest {
  $schema: './m0-manifest.v2.schema.json';
  schema: 'semantic-dark.m0-manifest.v2';
  id: 'semantic-dark.m0-v2-baseline';
  status: 'frozen';
  recordedAt: string;
  predecessor: {
    schema: 'semantic-dark.m0-manifest.v1';
    path: string;
    sha256: string;
  };
  baselineProfile: {
    path: string;
    fileSha256: string;
    semanticSha256: string;
  };
  commits: {engineIntervention: string; evaluator: string};
  implementationPins: {
    evaluatorTreeSha1: string;
    pinSetSha256: string;
    files: readonly M0V2ImplementationPin[];
  };
  evidence: {verify: M0V2EvidenceReference; e2e: M0V2EvidenceReference};
  environment: {
    platform: string;
    architecture: string;
    osRelease: string;
    nodeVersion: string;
    pnpmVersion: string;
    chromeVersion: string;
    headless: true;
    locale: 'en-US';
    colorProfile: 'srgb';
    renderViewport: M0V2Viewport;
    a3ProbeViewport: M0V2Viewport;
  };
  a3: M0V2A3Evidence;
}

export interface M0V2ToolIdentity {
  path: string;
  version: string;
}

export interface M0V2EvidenceCompletion {
  schema: 'semantic-dark.m0-evidence-completion.v2';
  id: string;
  command: M0V2EvidenceCommand;
  startedAt: string;
  completedAt: string;
  argv: readonly [string, 'verify' | 'e2e'];
  cwd: string;
  env: {
    HOME: string;
    PATH: string;
    TMPDIR: string;
    CI: '1';
    FORCE_COLOR: '0';
    LANG: 'en_US.UTF-8';
    LC_ALL: 'en_US.UTF-8';
    TZ: 'UTC';
    CHROME_PATH: string | null;
  };
  tools: {
    node: M0V2ToolIdentity;
    pnpm: M0V2ToolIdentity;
    git: M0V2ToolIdentity;
    chrome: M0V2ToolIdentity | null;
  };
  runtime: {platform: string; architecture: string; osRelease: string};
  git: {
    head: string;
    tree: string;
    cleanBefore: boolean;
    cleanAfter: boolean;
  };
  outcome: {
    exitCode: number | null;
    signal: string | null;
    status: 'passed' | 'failed';
  };
  log: M0V2ArtifactPin;
}
