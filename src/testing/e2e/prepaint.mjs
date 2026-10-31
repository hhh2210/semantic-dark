import assert from 'node:assert/strict';

const PREPAINT = 'data-semantic-dark-prepaint';

/** Records, per document, whether the dark base was ever painted and when. */
export async function installPrepaintRecorder(page) {
  await page.addInitScript((attribute) => {
    const record = {painted: null, firstPaint: null};
    Object.defineProperty(window, '__semanticDarkE2ePrepaint', {value: record});
    // The init script runs before <html> exists; watch the document instead.
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target === document.documentElement && mutation.target.hasAttribute(attribute)) {
          record.painted ??= performance.now();
        }
      }
    }).observe(document, {subtree: true, attributes: true, attributeFilter: [attribute]});
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-paint') record.firstPaint ??= entry.startTime;
      }
    }).observe({type: 'paint', buffered: true});
  }, PREPAINT);
}

export async function readPrepaintRecord(page) {
  return page.evaluate((attribute) => ({
    ...window.__semanticDarkE2ePrepaint,
    present: document.documentElement.hasAttribute(attribute),
  }), PREPAINT);
}

export async function waitForPrepaintReleased(page, timeout = 15_000) {
  await page.waitForFunction((attribute) => !document.documentElement.hasAttribute(attribute),
    PREPAINT, {timeout});
}

/** The service worker excludes disabled hosts from the document_start script. */
export async function waitForPrepaintExclusion({session, host, excluded, timeout = 15_000}) {
  const worker = session.context.serviceWorkers().find((item) => item.url() === session.serviceWorkerUrl);
  assert.ok(worker, 'Extension service worker is not running');
  const pattern = `*://${host.replace(/:\d+$/, '')}/*`;
  const deadline = Date.now() + timeout;
  for (;;) {
    const [script] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    assert.ok(script, 'Pre-paint content script is not registered');
    if ((script.excludeMatches ?? []).includes(pattern) === excluded) return script;
    if (Date.now() > deadline) {
      throw new Error(`Pre-paint exclusion of ${pattern} did not become ${excluded}: ${JSON.stringify(script)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * The base must lose to mapped surfaces and must not be visible to the mapper.
 * Both depend on the real cascade: :where() specificity, author origin, and
 * !important against inline styles, so only a browser can check them.
 */
export async function verifyPrepaintCascade(page) {
  const cascade = await page.evaluate((attribute) => {
    const root = document.documentElement;
    const mapped = [...document.querySelectorAll('body [data-semantic-dark-background]')]
      .find((element) => element.style.getPropertyValue('--semantic-dark-background'));
    if (!mapped) throw new Error('No mapped surface to check the pre-paint cascade against');
    const authored = document.createElement('div');
    authored.style.backgroundColor = 'rgb(255, 255, 255)';
    authored.textContent = 'pre-paint probe';
    document.body.append(authored);
    try {
      const mappedBefore = getComputedStyle(mapped).backgroundColor;
      root.setAttribute(attribute, '');
      const mappedDuring = getComputedStyle(mapped).backgroundColor;
      const unmapped = getComputedStyle(authored).backgroundColor;
      authored.setAttribute('data-semantic-dark-updating', '');
      const beingMapped = getComputedStyle(authored).backgroundColor;
      return {
        mappedBefore,
        mappedDuring,
        unmapped,
        beingMapped,
        root: getComputedStyle(root).backgroundColor,
      };
    } finally {
      root.removeAttribute(attribute);
      authored.remove();
    }
  }, PREPAINT);
  assert.equal(cascade.mappedDuring, cascade.mappedBefore, 'Pre-paint overrode a mapped surface');
  assert.equal(cascade.unmapped, 'rgba(0, 0, 0, 0)', 'Pre-paint left an unmapped light surface painted');
  assert.equal(cascade.beingMapped, 'rgb(255, 255, 255)', 'The mapper would read the pre-paint, not the authored color');
  assert.equal(cascade.root, 'rgb(17, 20, 22)', 'Pre-paint did not paint the dark root');
  return cascade;
}

export function verifyPrepaintedDocument(record, label) {
  assert.ok(record.painted != null, `${label}: the dark base was never painted`);
  assert.ok(record.firstPaint == null || record.painted <= record.firstPaint,
    `${label}: the dark base was painted after the first frame (${JSON.stringify(record)})`);
  assert.equal(record.present, false, `${label}: the dark base outlived the theme decision`);
}
