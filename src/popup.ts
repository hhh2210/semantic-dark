import {
  normalizeThemeConfig,
  type NormalizedThemeConfig,
  type PageThemeStatus,
  type RuntimeMessage,
  type ThemeMode,
} from './types';

const popup = required<HTMLElement>('#popup');
const hostLabel = required<HTMLElement>('#host');
const badge = required<HTMLElement>('#site-state');
const enabled = required<HTMLInputElement>('#enabled');
const enabledHint = required<HTMLElement>('#enabled-hint');
const siteNoteRow = required<HTMLElement>('#site-note-row');
const siteNote = required<HTMLElement>('#site-note');
const resetMode = required<HTMLButtonElement>('#reset-mode');
const appearance = required<HTMLFieldSetElement>('#appearance');
const background = required<HTMLInputElement>('#background');
const contrast = required<HTMLInputElement>('#contrast');
const contrastValue = required<HTMLOutputElement>('#contrast-value');
const error = required<HTMLElement>('#error');

let tabId: number | null = null;
let host = '';
let config = normalizeThemeConfig();
let confirmedConfig = config;
let pageStatus = pendingStatus();
let saveQueue: Promise<void> = Promise.resolve();
let saveRevision = 0;

interface ActiveTabContext {
  id: number;
  host: string;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popup element: ${selector}`);
  return element;
}

async function currentTab(): Promise<ActiveTabContext | null> {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (tab?.id == null || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return {id: tab.id, host: url.host};
  } catch {
    return null;
  }
}

function pendingStatus(): PageThemeStatus {
  return {
    mode: config.mode,
    effectiveEnabled: false,
    decision: 'pending',
    reason: 'popup-loading',
  };
}

function render(): void {
  const presentation = statusPresentation(pageStatus);
  popup.setAttribute('aria-busy', String(pageStatus.decision === 'pending'));
  hostLabel.textContent = host || 'Current page';
  badge.textContent = presentation.badge;
  badge.dataset.state = pageStatus.effectiveEnabled ? 'active' : 'neutral';
  enabledHint.textContent = presentation.hint;
  enabled.checked = pageStatus.effectiveEnabled;
  enabled.disabled = tabId === null || presentation.locked;

  background.value = config.background;
  contrast.value = String(config.minimumTextContrast);
  updateContrastLabel();
  appearance.disabled = !pageStatus.effectiveEnabled;
  appearance.hidden = !pageStatus.effectiveEnabled;

  siteNote.textContent = presentation.note;
  siteNote.hidden = presentation.note.length === 0;
  resetMode.hidden = config.mode === 'auto';
  siteNoteRow.hidden = siteNote.hidden && resetMode.hidden;
}

function statusPresentation(status: PageThemeStatus): {
  badge: string;
  hint: string;
  note: string;
  locked: boolean;
} {
  switch (status.decision) {
    case 'system-light':
      return {
        badge: 'System light',
        hint: 'Following your system appearance',
        note: 'Semantic Dark will turn on when your system switches to dark.',
        locked: false,
      };
    case 'applied-light':
      return {badge: 'On', hint: 'Applied automatically to this light page', note: '', locked: false};
    case 'native-dark':
      return {
        badge: 'Already dark',
        hint: 'The site appearance is left unchanged',
        note: 'This site already provides a dark appearance. Turn on to override it.',
        locked: false,
      };
    case 'ambiguous':
      return {
        badge: 'Left unchanged',
        hint: 'The page appearance could not be classified safely',
        note: 'Semantic Dark stays off when detection is uncertain. Turn on to override it.',
        locked: false,
      };
    case 'forced-colors':
      return {
        badge: 'System colors',
        hint: 'The browser is controlling page colors',
        note: 'Forced Colors is active, so Semantic Dark will not override it.',
        locked: true,
      };
    case 'user-on':
      return {
        badge: 'On',
        hint: 'Manual override for this site',
        note: 'Automatic detection is paused for this site.',
        locked: false,
      };
    case 'user-off':
      return {
        badge: 'Off',
        hint: 'Disabled for this site',
        note: 'Automatic detection is paused for this site.',
        locked: false,
      };
    case 'pending':
      return {badge: 'Checking', hint: 'Checking the page appearance…', note: '', locked: true};
  }
}

function optimisticStatus(mode: ThemeMode): PageThemeStatus {
  if (mode === 'on') {
    return {mode, effectiveEnabled: true, decision: 'user-on', reason: 'popup-user-on'};
  }
  if (mode === 'off') {
    return {mode, effectiveEnabled: false, decision: 'user-off', reason: 'popup-user-off'};
  }
  if (pageStatus.mode === 'auto' && pageStatus.decision !== 'pending') {
    return {...pageStatus, mode};
  }
  return {mode, effectiveEnabled: false, decision: 'pending', reason: 'popup-auto-reset'};
}

function updateContrastLabel(): void {
  const value = Number(contrast.value).toFixed(1);
  contrastValue.value = `${value}:1`;
  contrast.setAttribute('aria-valuetext', `${value} to 1`);
}

async function readPageStatus(): Promise<PageThemeStatus> {
  if (tabId === null || !host) return pendingStatus();
  const message: RuntimeMessage = {type: 'semantic-dark:get-status', host};
  return chrome.tabs.sendMessage(tabId, message, {frameId: 0});
}

async function refreshPageStatus(attempts = 12): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    pageStatus = await readPageStatus();
    render();
    if (pageStatus.decision !== 'pending') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function persist(next: NormalizedThemeConfig): void {
  const revision = ++saveRevision;
  config = next;
  pageStatus = optimisticStatus(next.mode);
  hideError();
  render();

  saveQueue = saveQueue.then(async () => {
    const message: RuntimeMessage = {type: 'semantic-dark:set-config', host, config: next};
    const saved = normalizeThemeConfig(await chrome.runtime.sendMessage(message));
    confirmedConfig = saved;
    if (revision === saveRevision) config = saved;
    await refreshPageStatus();
  }).catch(async () => {
    if (revision !== saveRevision) return;
    config = confirmedConfig;
    try { pageStatus = await readPageStatus(); } catch { pageStatus = pendingStatus(); }
    showError('Could not save this setting. The previous value was restored.');
    render();
  });
}

function showError(message: string): void {
  error.textContent = message;
  error.hidden = false;
}

function hideError(): void {
  error.textContent = '';
  error.hidden = true;
}

enabled.addEventListener('change', () => {
  const mode: ThemeMode = enabled.checked ? 'on' : 'off';
  persist(normalizeThemeConfig({...config, mode, enabled: mode === 'on'}));
});

background.addEventListener('change', () => {
  persist(normalizeThemeConfig({...config, background: background.value}));
});

contrast.addEventListener('input', updateContrastLabel);
contrast.addEventListener('change', () => {
  persist(normalizeThemeConfig({...config, minimumTextContrast: Number(contrast.value)}));
});

resetMode.addEventListener('click', () => {
  persist(normalizeThemeConfig({...config, mode: 'auto', enabled: true}));
});

void (async () => {
  const context = await currentTab();
  if (!context) {
    popup.setAttribute('aria-busy', 'false');
    hostLabel.textContent = 'Unavailable on this page';
    badge.textContent = 'Unavailable';
    badge.dataset.state = 'neutral';
    enabledHint.textContent = 'Open a regular website to use Semantic Dark';
    enabled.checked = false;
    enabled.disabled = true;
    appearance.hidden = true;
    siteNoteRow.hidden = true;
    return;
  }

  tabId = context.id;
  host = context.host;
  const message: RuntimeMessage = {type: 'semantic-dark:get-config', host};
  config = normalizeThemeConfig(await chrome.runtime.sendMessage(message));
  confirmedConfig = config;
  pageStatus = pendingStatus();
  render();
  try {
    await refreshPageStatus();
  } catch {
    pageStatus = {
      mode: config.mode,
      effectiveEnabled: false,
      decision: 'ambiguous',
      reason: 'content-script-unavailable',
    };
    showError('Reload this page once so Semantic Dark can inspect it.');
    render();
  }
})();
