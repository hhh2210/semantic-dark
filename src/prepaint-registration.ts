import {CONFIG_KEY_PREFIX, normalizeThemeConfig, type ThemeConfig} from './types';

export const PREPAINT_SCRIPT_ID = 'semantic-dark-prepaint';

// A stored key is a page's location.host: a host name or bracketed IPv6
// literal, with an optional port. Nothing here can alter pattern syntax.
const HOST_PATTERN = /^([a-z0-9_.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/**
 * Match patterns for every disabled host. Chrome rejects ports in content
 * script patterns, so a disabled host is excluded on all of its ports;
 * over-excluding only costs those origins their document_start pre-paint.
 */
export function disabledHostPatterns(records: Record<string, unknown>): string[] {
  const patterns = Object.entries(records).flatMap(([key, value]) => {
    if (!key.startsWith(CONFIG_KEY_PREFIX)) return [];
    const hostname = HOST_PATTERN.exec(key.slice(CONFIG_KEY_PREFIX.length))?.[1];
    if (!hostname) return [];
    const config = normalizeThemeConfig(value as Partial<ThemeConfig> | undefined);
    return config.mode === 'off' ? [`*://${hostname.toLowerCase()}/*`] : [];
  });
  return [...new Set(patterns)];
}

export function prepaintScript(records: Record<string, unknown>): chrome.scripting.RegisteredContentScript {
  return {
    id: PREPAINT_SCRIPT_ID,
    js: ['prepaint.js'],
    matches: ['http://*/*', 'https://*/*'],
    excludeMatches: disabledHostPatterns(records),
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: true,
  };
}

export interface PrepaintRegistrationApi {
  scripting: Pick<typeof chrome.scripting, 'getRegisteredContentScripts' |
    'registerContentScripts' | 'updateContentScripts' | 'unregisterContentScripts'>;
  storage: {get(keys: null): Promise<Record<string, unknown>>};
}

/** Returns a sync function; calls are serialized so overlapping syncs cannot race on one id. */
export function prepaintRegistration({scripting, storage}: PrepaintRegistrationApi): () => Promise<void> {
  let pending = Promise.resolve();
  return () => {
    pending = pending.then(async () => {
      const script = prepaintScript(await storage.get(null));
      const registered = await scripting.getRegisteredContentScripts({ids: [PREPAINT_SCRIPT_ID]});
      if (registered.length > 0) await scripting.updateContentScripts([script]);
      else await scripting.registerContentScripts([script]);
    }).catch(async (error: unknown) => {
      // A stale exclusion list would pre-paint a newly disabled host. Without
      // the script, content scripts still apply the base once config loads.
      console.warn('Semantic Dark could not register its pre-paint script', error);
      await scripting.unregisterContentScripts({ids: [PREPAINT_SCRIPT_ID]}).catch(() => {});
    });
    return pending;
  };
}
