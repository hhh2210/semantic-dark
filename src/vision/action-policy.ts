import {logoActionContrast} from './logo-contrast';
import type {RGBAImage, VisualResourceClassification} from './types';

export type AssetAction = 'keep' | 'dim' | 'monochrome' | 'diagram' | 'backplate';

/** Source pixels and current paint context, not authored-dark targets or labels. */
export interface AssetObservation {
  schema: 'semantic-dark.asset-decision.v1';
  source: string;
  pixels: RGBAImage;
  classification: VisualResourceClassification;
  canvasBackground: string;
  elementBackground: string;
  parentBackground: string;
  simpleBackdrop?: boolean;
}

export interface AssetDecision {
  action: AssetAction;
  authority: 'heuristic' | 'provider' | 'fallback' | 'constraint';
  reason: string;
}

/** Injection point for a local model. No network/backend is installed by default. */
export interface AssetDecisionProvider {
  requiresOptIn?: boolean;
  isApplicable?(observation: AssetObservation): boolean;
  decide(observation: AssetObservation, allowed: readonly AssetAction[], signal: AbortSignal): Promise<unknown>;
}

/** Existing heuristic eligibility, kept outside model control. Not a calibrated safety claim. */
export function allowedAssetActions(value: VisualResourceClassification): readonly AssetAction[] {
  if (!Number.isFinite(value.confidence) || !Number.isFinite(value.features.transparentRatio) || value.confidence < 0.58 || value.kind === 'unknown') return ['keep'];
  const backing: AssetAction[] = value.features.transparentRatio > 0.01 ? ['backplate'] : [];
  if (value.kind === 'diagram') return ['keep', 'dim', 'diagram', ...backing];
  if (value.kind === 'icon' && value.policy === 'recolor') return ['keep', 'dim', 'monochrome', ...backing];
  return ['keep', 'dim', ...(value.kind === 'icon' ? backing : [])];
}

export function heuristicAssetDecision(value: VisualResourceClassification): AssetDecision {
  const desired = value.kind === 'diagram' ? 'diagram'
    : value.policy === 'recolor' ? 'monochrome' : value.policy;
  const action = allowedAssetActions(value).find((action) => action === desired) ?? 'keep';
  return {action, authority: 'heuristic', reason: 'existing-feature-router'};
}

/** Bounded async decision; malformed, disallowed, failed or late answers preserve the source. */
export async function decideAsset(
  observation: AssetObservation,
  provider: AssetDecisionProvider | undefined,
  signal: AbortSignal,
  timeoutMs = 500,
): Promise<AssetDecision> {
  const fallback = (reason: string): AssetDecision => ({action: 'keep', authority: 'fallback', reason});
  if (signal.aborted) return fallback('cancelled');
  const contrast = logoActionContrast(observation);
  if (contrast && contrast.keep < 3 && contrast.backplate >= 3) {
    return {action: 'backplate', authority: 'constraint', reason: 'transparent-logo-contrast'};
  }
  if (contrast && contrast.keep >= 3 && observation.classification.policy === 'recolor') {
    return {action: 'keep', authority: 'constraint', reason: 'logo-already-readable'};
  }
  if (!provider) return heuristicAssetDecision(observation.classification);
  const allowed = Object.freeze([...allowedAssetActions(observation.classification)]);
  if (allowed.length === 1) return fallback('ineligible');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fallback('invalid-deadline');

  const deadline = performance.now() + timeoutMs;
  const request = new AbortController();
  let cancel!: () => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadlineExpired = false;
  const stopped = new Promise<undefined>((resolve) => {
    cancel = () => { request.abort(); resolve(undefined); };
    signal.addEventListener('abort', cancel, {once: true});
    timer = setTimeout(() => { deadlineExpired = true; cancel(); }, timeoutMs);
  });
  try {
    const answer = await Promise.race([
      Promise.resolve().then(() => request.signal.aborted ? undefined : provider.decide(observation, allowed, request.signal)), stopped,
    ]);
    if (signal.aborted) return fallback('cancelled');
    if (deadlineExpired || performance.now() >= deadline) return fallback('timeout');
    if (!answer || typeof answer !== 'object' || !('action' in answer) || typeof answer.action !== 'string' ||
        !allowed.includes(answer.action as AssetAction)) return fallback('invalid-or-disallowed-action');
    if (contrast && answer.action !== 'keep' && answer.action in contrast &&
        contrast[answer.action as keyof typeof contrast] < 3) return fallback('logo-contrast-rejected');
    return {action: answer.action as AssetAction, authority: 'provider', reason: 'cached' in answer && answer.cached === true ? 'cached-provider-action' : 'selected-allowed-action'};
  } catch {
    return fallback('provider-error');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    request.abort();
  }
}
