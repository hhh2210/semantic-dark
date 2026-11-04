import {DomThemeEngine} from './dom-engine';
import {ImageThemeEngine} from './image-engine';
import {NativeDarkDetector} from './native-dark';
import {claimDarkBase} from './prepaint';
import {SvgThemeEngine} from './svg-engine';
import {ThemeController} from './theme-controller';
import {observeInsecureMedia} from './upgrade-insecure';
import {
  configStorageKey,
  normalizeThemeConfig,
  type NormalizedThemeConfig,
  type PageThemeStatus,
  type RuntimeMessage,
  type ThemeConfig,
} from '../types';

// Xiaohongshu and similar sites still author `http:` CDN media on HTTPS pages.
// Chrome auto-upgrades the request, but attributes the Mixed Content warning to
// whatever content-script stack forced layout (`getComputedStyle` / `decode`).
// Rewrite the DOM URLs first so engine work never sits on an `http:` load stack.
observeInsecureMedia(document);

const host = location.host;
let controller: ThemeController | null = null;

// Read storage directly: the pre-paint waits for this, and waking the service
// worker for a message round trip can take longer than the first paint.
async function loadConfig(): Promise<NormalizedThemeConfig> {
  try {
    const key = configStorageKey(host);
    const record = await chrome.storage.local.get(key);
    return normalizeThemeConfig(record[key] as Partial<ThemeConfig> | undefined);
  } catch {
    return normalizeThemeConfig();
  }
}

void loadConfig().then((config) => {
  const dormant = {...config, enabled: false};
  const dom = new DomThemeEngine(dormant);
  const svg = new SvgThemeEngine(dormant);
  const image = new ImageThemeEngine(dormant);
  controller = new ThemeController(config, new NativeDarkDetector(), {dom, svg, image}, {
    // A frame may be a transparent embed; only a top-level page owns its canvas.
    prepaint: window === window.top,
  });
  claimDarkBase();
  void controller.start();
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.host !== host) return;
  if (message.type === 'semantic-dark:config-changed') {
    void controller?.update(message.config);
    return;
  }
  if (message.type === 'semantic-dark:get-status') {
    const pending: PageThemeStatus = {
      mode: 'auto',
      effectiveEnabled: false,
      decision: 'pending',
      reason: 'content-controller-loading',
    };
    sendResponse(controller?.getStatus() ?? pending);
  }
});

let styleChangeTimer: number | undefined;
document.addEventListener('semantic-dark:page-style-changed', () => {
  clearTimeout(styleChangeTimer);
  styleChangeTimer = window.setTimeout(() => {
    controller?.rescan();
    void controller?.recheck(true);
  }, 50);
});
