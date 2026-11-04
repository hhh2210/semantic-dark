import {compositeSrgb, formatRgba8CssColor, parseCssColor} from '../color';
import type {AssetDecisionProvider} from '../vision/action-policy';

/** Opt-in local companion. Only transparent colored logos need this first policy. */
export const localModelProvider: AssetDecisionProvider = {
  requiresOptIn: true,
  isApplicable(observation) {
    const {classification} = observation;
    return observation.simpleBackdrop === true && classification.kind === 'icon' && classification.policy === 'keep' &&
      classification.features.transparentRatio > 0.01;
  },
  async decide(observation, allowed, signal) {
    if (signal.aborted) return null;
    const element = parseCssColor(observation.elementBackground);
    const parent = parseCssColor(observation.parentBackground);
    if (!element || !parent) return null;
    return chrome.runtime.sendMessage({
      type: 'semantic-dark:asset-decision',
      pixels: {width: observation.pixels.width, height: observation.pixels.height,
        data: Array.from(observation.pixels.data)},
      background: formatRgba8CssColor(compositeSrgb(element, parent)),
      canvasBackground: observation.canvasBackground,
      allowed: allowed.filter(action => ['keep', 'dim', 'backplate'].includes(action)),
    });
  },
};
