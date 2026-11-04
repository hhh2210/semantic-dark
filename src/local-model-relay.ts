import {configStorageKey, normalizeThemeConfig, type ThemeConfig} from './types';

export interface AssetDecisionMessage {
  type: 'semantic-dark:asset-decision';
  pixels: {width: number; height: number; data: number[]};
  background: string;
  canvasBackground: string;
  allowed: string[];
}

/** Fixed loopback destination; per-site opt-in is checked in the privileged process. */
export async function relayAssetDecision(message: AssetDecisionMessage, sender: chrome.runtime.MessageSender) {
  const keep = null;
  if (sender.tab?.id == null || !sender.url) return keep;
  let url: URL;
  try { url = new URL(sender.url); } catch { return keep; }
  if (!['http:', 'https:'].includes(url.protocol)) return keep;
  const key = configStorageKey(url.host);
  const record = await chrome.storage.local.get(key);
  const config = normalizeThemeConfig(record[key] as Partial<ThemeConfig> | undefined);
  if (!config.localModel || config.mode === 'off') return keep;
  const {width, height, data} = message.pixels ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 128 || height > 128 || !Array.isArray(data) || data.length !== width * height * 4 ||
      data.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return keep;
  const allowed = message.allowed?.filter(action => ['keep', 'dim', 'backplate'].includes(action));
  if (!allowed?.includes('keep')) return keep;
  try {
    const response = await fetch('http://127.0.0.1:18949/decide', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pixels: {width, height, data}, background: message.background,
        canvasBackground: message.canvasBackground, allowed}),
      signal: AbortSignal.timeout(450),
    });
    if (!response.ok) return keep;
    const answer: unknown = await response.json();
    if (!answer || typeof answer !== 'object' || !('action' in answer) || !allowed.includes(String(answer.action))) return keep;
    return {action: String(answer.action), cached: 'cached' in answer && answer.cached === true};
  } catch { return keep; }
}
