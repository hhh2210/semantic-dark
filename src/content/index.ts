import {DomThemeEngine} from './dom-engine';
import {ImageThemeEngine} from './image-engine';
import {NativeDarkDetector} from './native-dark';
import {SvgThemeEngine} from './svg-engine';
import {ThemeController} from './theme-controller';
import {
  normalizeThemeConfig,
  type NormalizedThemeConfig,
  type PageThemeStatus,
  type RuntimeMessage,
} from '../types';

const host = location.host;
let controller: ThemeController | null = null;

async function loadConfig(): Promise<NormalizedThemeConfig> {
  try {
    const message: RuntimeMessage = {type: 'semantic-dark:get-config', host};
    return normalizeThemeConfig(await chrome.runtime.sendMessage(message));
  } catch {
    return normalizeThemeConfig();
  }
}

void loadConfig().then((config) => {
  const dormant = {...config, enabled: false};
  const dom = new DomThemeEngine(dormant);
  const svg = new SvgThemeEngine(dormant);
  const image = new ImageThemeEngine(dormant);
  controller = new ThemeController(config, new NativeDarkDetector(), {dom, svg, image});
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
    void controller?.recheck();
  }, 50);
});
