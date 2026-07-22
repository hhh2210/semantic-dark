import {chromium} from 'playwright';

export async function captureBaseline({
  chromePath,
  headless,
  viewport,
  url,
  screenshotPath,
  readState,
}) {
  const browser = await chromium.launch({executablePath: chromePath, headless});
  try {
    const page = await browser.newPage({viewport});
    await page.goto(url, {waitUntil: 'networkidle'});
    await page.screenshot({path: screenshotPath, fullPage: true});
    return {state: await readState(page), browserVersion: browser.version()};
  } finally {
    await browser.close();
  }
}

function attachDiagnostics(page, consoleMessages, pageErrors) {
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()} ${page.url()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(`${page.url()}: ${error.message}`));
}

async function extensionIdentity(context, timeout) {
  let worker = context.serviceWorkers().find((candidate) =>
    candidate.url().startsWith('chrome-extension://'));
  worker ??= await context.waitForEvent('serviceworker', {
    predicate: (candidate) => candidate.url().startsWith('chrome-extension://'),
    timeout,
  });
  const serviceWorkerUrl = worker.url();
  const extensionId = new URL(serviceWorkerUrl).hostname;
  if (!extensionId) throw new Error(`Could not derive extension id from ${serviceWorkerUrl}`);
  return {extensionId, serviceWorkerUrl};
}

export async function openExtensionSession({
  chromePath,
  extensionDir,
  profilePath,
  headless,
  viewport,
  colorScheme,
  url,
  timeout = 15_000,
}) {
  const consoleMessages = [];
  const pageErrors = [];
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromePath,
    headless,
    viewport,
    colorScheme,
    args: [
      // Chrome-branded builds enable these two guards by default. Disabling the
      // guards restores the documented unpacked-extension test flags.
      '--disable-features=DisableLoadExtensionCommandLineSwitch,DisableDisableExtensionsExceptCommandLineSwitch',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  context.on('page', (candidate) => attachDiagnostics(candidate, consoleMessages, pageErrors));
  try {
    const page = await context.newPage();
    await page.goto(url, {waitUntil: 'networkidle'});
    const identity = await extensionIdentity(context, timeout);
    return {
      context,
      page,
      consoleMessages,
      pageErrors,
      ...identity,
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function setCurrentHostEnabled({
  session,
  enabled,
  expectedInitial,
  expectedHost,
  timeout = 15_000,
}) {
  const popup = await session.context.newPage();
  try {
    await session.page.bringToFront();
    await popup.goto(`chrome-extension://${session.extensionId}/popup.html`, {waitUntil: 'load'});
    const checkbox = popup.locator('#enabled');
    await checkbox.waitFor({state: 'visible', timeout});
    const activeTabUrl = await popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      return tab?.url ?? '';
    });
    const activeHost = activeTabUrl ? new URL(activeTabUrl).host : '';
    if (activeHost !== expectedHost) {
      throw new Error(`Popup targeted ${activeHost || '<empty>'}, expected ${expectedHost}`);
    }

    const initialEnabled = await checkbox.isChecked();
    if (initialEnabled !== expectedInitial) {
      throw new Error(`Popup enabled state was ${initialEnabled}, expected ${expectedInitial}`);
    }
    if (enabled) await checkbox.check();
    else await checkbox.uncheck();
    const expectedMode = enabled ? 'on' : 'off';
    await popup.waitForFunction(async ({host, expectedMode, enabled}) => {
      const key = `semantic-dark:${host}`;
      const stored = (await chrome.storage.local.get(key))[key];
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (stored?.mode !== expectedMode || tab?.id == null) return false;
      try {
        const status = await chrome.tabs.sendMessage(
          tab.id,
          {type: 'semantic-dark:get-status', host},
          {frameId: 0},
        );
        return status?.effectiveEnabled === enabled &&
          status?.decision === (enabled ? 'user-on' : 'user-off');
      } catch {
        return false;
      }
    }, {host: expectedHost, expectedMode, enabled}, {timeout});

    return {
      activeTabUrl,
      initialEnabled,
      finalEnabled: await checkbox.isChecked(),
      mode: expectedMode,
      badge: await popup.locator('#site-state').textContent(),
    };
  } finally {
    await popup.close();
    await session.page.bringToFront();
  }
}

export async function resetCurrentHostAutomatic({
  session,
  expectedHost,
  timeout = 15_000,
}) {
  const popup = await session.context.newPage();
  try {
    await session.page.bringToFront();
    await popup.goto(`chrome-extension://${session.extensionId}/popup.html`, {waitUntil: 'load'});
    const reset = popup.locator('#reset-mode');
    await reset.waitFor({state: 'visible', timeout});
    await reset.click();
    await waitForPopupStatus(popup, {
      host: expectedHost,
      mode: 'auto',
      decision: 'applied-light',
      enabled: true,
      timeout,
    });
    await popup.waitForFunction(() => {
      const badge = document.querySelector('#site-state');
      const checkbox = document.querySelector('#enabled');
      return badge?.textContent?.trim() === 'On' && checkbox instanceof HTMLInputElement &&
        checkbox.checked && !checkbox.disabled;
    }, undefined, {timeout});
    return {
      mode: 'auto',
      badge: await popup.locator('#site-state').textContent(),
      enabled: await popup.locator('#enabled').isChecked(),
    };
  } finally {
    await popup.close();
    await session.page.bringToFront();
  }
}

export async function inspectCurrentPopup({
  session,
  expectedHost,
  expectedDecision,
  expectedEnabled,
  screenshotPath,
  colorScheme = 'light',
  timeout = 15_000,
}) {
  const popup = await session.context.newPage();
  try {
    await session.page.bringToFront();
    await popup.goto(`chrome-extension://${session.extensionId}/popup.html`, {waitUntil: 'load'});
    await popup.emulateMedia({colorScheme});
    await waitForPopupStatus(popup, {
      host: expectedHost,
      decision: expectedDecision,
      enabled: expectedEnabled,
      timeout,
    });
    const metrics = await popup.evaluate(() => {
      const required = (selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing popup element ${selector}`);
        return element;
      };
      const rect = (selector) => {
        const bounds = required(selector).getBoundingClientRect();
        return {width: bounds.width, height: bounds.height};
      };
      const style = (selector) => {
        const computed = getComputedStyle(required(selector));
        return {color: computed.color, background: computed.backgroundColor};
      };
      return {
        popup: rect('#popup'),
        switch: rect('#enabled'),
        color: rect('#background'),
        range: rect('#contrast'),
        headingStyle: style('h1'),
        controlStyle: style('#enabled-label'),
        hostStyle: style('#host'),
        bodyStyle: style('body'),
        surfaceStyle: style('.activation-panel'),
        badge: required('#site-state').textContent?.trim() ?? '',
        hint: required('#enabled-hint').textContent?.trim() ?? '',
        note: required('#site-note').textContent?.trim() ?? '',
        appearanceHidden: required('#appearance').hidden,
        enabledDisabled: required('#enabled').disabled,
        errorHidden: required('#error').hidden,
      };
    });
    await popup.locator('#popup').screenshot({path: screenshotPath});
    return {colorScheme, screenshotPath, ...metrics};
  } finally {
    await popup.close();
    await session.page.bringToFront();
  }
}

async function waitForPopupStatus(popup, {
  host,
  mode,
  decision,
  enabled,
  timeout,
}) {
  await popup.waitForFunction(async ({host, mode, decision, enabled}) => {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab?.id == null) return false;
    try {
      const status = await chrome.tabs.sendMessage(
        tab.id,
        {type: 'semantic-dark:get-status', host},
        {frameId: 0},
      );
      const modeMatches = mode == null || status?.mode === mode;
      return modeMatches && status?.decision === decision && status?.effectiveEnabled === enabled;
    } catch {
      return false;
    }
  }, {host, mode: mode ?? null, decision, enabled}, {timeout});
}

export function sessionDiagnostics(session, state) {
  return {
    extensionId: session.extensionId,
    serviceWorkerUrl: session.serviceWorkerUrl,
    serviceWorkers: session.context.serviceWorkers().map((worker) => worker.url()),
    state,
    consoleMessages: session.consoleMessages,
    pageErrors: session.pageErrors,
  };
}
