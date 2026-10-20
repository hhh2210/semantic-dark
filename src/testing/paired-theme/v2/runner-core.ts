import {chromium, type Browser} from 'playwright';

import type {RoleProfiles} from '../../../color/role-profiles';
import {serializeCanonicalJson, sha256Text} from '../../artifacts';
import {renderPairedThemeDocument} from '../render';
import {collectV2PaintObservations, type V2PaintCollectionInput} from './collector';
import {
  requireRegisteredSystem,
  type ValidatedV2EvaluationContract,
} from './contract';
import {evaluateV2System, type V2SystemComparison} from './evaluate';
import type {V2NormalizedThemePair} from './exported-theme-source';
import {
  buildV2ObservationReplicate,
  type V2ObservationReplicate,
  type V2PaintObservation,
} from './observations';
import type {LoadedV2RegisteredProtocol} from './protocol';
import {buildV2ThemeVariantValues} from './variants';

export interface V2ResolvedSystemRunInput {
  contract: ValidatedV2EvaluationContract;
  /** Protocol loaded from pinned registry bytes; supplies scenes, viewport, and locale. */
  loaded: LoadedV2RegisteredProtocol;
  theme: V2NormalizedThemePair;
  baselineProfiles: RoleProfiles;
  candidateProfiles: RoleProfiles;
  chromePath: string;
  headless?: boolean;
}

export interface V2ReplicateIdentity {
  replicateId: string;
  browserVersion: string;
  observationSha256: string;
  renderSha256: Readonly<Record<string, string>>;
}

export interface V2ResolvedSystemRunResult {
  system: string;
  comparison: V2SystemComparison;
  replicates: readonly V2ObservationReplicate[];
  identities: readonly V2ReplicateIdentity[];
}

interface V2RunnerDependencies {
  launchBrowser(input: V2ResolvedSystemRunInput): Promise<Browser>;
  collect(browser: Browser, input: V2PaintCollectionInput): Promise<V2PaintObservation[]>;
}

const DEFAULT_DEPENDENCIES: V2RunnerDependencies = {
  launchBrowser: (input) => chromium.launch({
    executablePath: input.chromePath,
    headless: input.headless !== false,
    args: ['--force-color-profile=srgb'],
  }),
  collect: collectV2PaintObservations,
};

/** Run one authenticated registry system with two fresh browsers and both profile arms. */
export async function runV2ResolvedSystem(
  input: V2ResolvedSystemRunInput,
  dependencies: V2RunnerDependencies = DEFAULT_DEPENDENCIES,
): Promise<V2ResolvedSystemRunResult> {
  requireRegisteredSystem(input.contract, input.theme.system, input.theme.split);
  if (input.loaded.registry.id !== input.theme.system
    || input.loaded.registry.split !== input.theme.split) {
    throw new Error('V2 runner theme differs from the loaded registered protocol');
  }
  const scenes = input.loaded.scenes.scenes;
  const variants = buildV2ThemeVariantValues(
    input.theme,
    scenes,
    input.baselineProfiles,
    input.candidateProfiles,
    input.contract.variants.roles,
  );
  assertVariantInventory(variants.values, input.contract.variants.ordered);
  const replicates: V2ObservationReplicate[] = [];
  const identities: V2ReplicateIdentity[] = [];
  for (let index = 0; index < input.contract.replicatesPerSystem; index += 1) {
    const replicateId = `launch-${String.fromCharCode(97 + index)}`;
    const collected = await collectReplicate(input, dependencies, variants.values, replicateId);
    const replicate = buildV2ObservationReplicate({
      system: input.theme.system,
      split: input.theme.split,
      replicateId,
      observations: collected.observations,
    }, input.contract, input.loaded);
    replicates.push(replicate);
    identities.push({
      replicateId,
      browserVersion: collected.browserVersion,
      observationSha256: replicate.observationSha256,
      renderSha256: collected.renderSha256,
    });
  }
  assertReplicateIdentity(identities);
  return {
    system: input.theme.system,
    comparison: evaluateV2System(replicates, input.loaded, input.contract),
    replicates,
    identities,
  };
}

async function collectReplicate(
  input: V2ResolvedSystemRunInput,
  dependencies: V2RunnerDependencies,
  values: Readonly<Record<string, Readonly<Record<string, string>>>>,
  replicateId: string,
) {
  const browser = await dependencies.launchBrowser(input);
  const {scenes} = input.loaded.scenes;
  const {viewport, locale} = input.loaded.protocol;
  const observations: V2PaintObservation[] = [];
  const renderSha256: Record<string, string> = {};
  let browserVersion: string;
  try {
    browserVersion = browser.version();
    for (const variant of input.contract.variants.ordered) {
      const html = renderPairedThemeDocument({
        title: `${input.theme.system} · ${variant}`,
        scenes,
        paintValues: values[variant]!,
      });
      renderSha256[variant] = sha256Text(html);
      observations.push(...await dependencies.collect(browser, {
        html,
        system: input.theme.system,
        split: input.theme.split,
        variant,
        scenes,
        viewport,
        locale,
      }));
    }
  } finally {
    await browser.close();
  }
  return {observations, browserVersion, renderSha256: sortRecord(renderSha256)};
}

function assertVariantInventory(
  values: Readonly<Record<string, unknown>>,
  ordered: readonly string[],
): void {
  const actual = Object.keys(values);
  if (actual.length !== ordered.length || actual.some((value, index) => value !== ordered[index])) {
    throw new Error('V2 rendered variant inventory differs from the authenticated spec');
  }
}

function assertReplicateIdentity(identities: readonly V2ReplicateIdentity[]): void {
  const first = identities[0];
  if (!first) throw new Error('V2 runner produced no replicate identity');
  const expected = serializeCanonicalJson({
    browserVersion: first.browserVersion,
    observationSha256: first.observationSha256,
    renderSha256: first.renderSha256,
  });
  for (const identity of identities.slice(1)) {
    const actual = serializeCanonicalJson({
      browserVersion: identity.browserVersion,
      observationSha256: identity.observationSha256,
      renderSha256: identity.renderSha256,
    });
    if (actual !== expected) throw new Error(`${identity.replicateId} does not reproduce launch-a`);
  }
}

function sortRecord(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  ));
}
