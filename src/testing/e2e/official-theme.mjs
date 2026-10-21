import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

/** Exercise the built extension, real CSS loading and its public message/status API. */
export async function exerciseOfficialTheme({session, fixtureUrl, fixtureDir, artifactDir, routes, timeout}) {
  const {page, context} = session;
  const worker = context.serviceWorkers().find((item) => item.url() === session.serviceWorkerUrl);
  assert.ok(worker);
  const host = new URL(fixtureUrl).host;
  const html = await readFile(path.join(fixtureDir, 'official-theme.html'), 'utf8');
  const css = await readFile(path.join(fixtureDir, 'official-theme.css'), 'utf8');
  const results = [];
  let serial = 0;
  const requestCounts = new Map();
  const failedResponses = [];
  const recordResponse = (response) => {
    if (response.status() >= 400) failedResponses.push({url: response.url(), status: response.status()});
  };
  const countRequest = (request) => {
    const pathname = new URL(request.url()).pathname;
    requestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1);
  };
  page.on('request', countRequest);
  page.on('response', recordResponse);
  const originalRoutes = new Map(routes);
  function serve(url, body, {delayMs = 0, status = 200, type = 'text/css'} = {}) {
    routes.set(url, async (_request, response) => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      response.writeHead(status, {'content-type': type, 'cache-control': 'no-store'});
      response.end(body);
    });
  }

  async function mode(mode) {
    await worker.evaluate(async ({host, mode}) => {
      const config = {mode, enabled: mode !== 'off', background: '#111416', minimumTextContrast: 4.5};
      await chrome.storage.local.set({[`semantic-dark:${host}`]: config});
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id != null && tab.url?.startsWith(`http://${host}/`)) {
          await chrome.tabs.sendMessage(tab.id, {type: 'semantic-dark:config-changed', host, config});
        }
      }
    }, {host, mode});
  }
  async function status() {
    return worker.evaluate(async (host) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(`http://${host}/`));
      return chrome.tabs.sendMessage(tab.id, {type: 'semantic-dark:get-status', host}, {frameId: 0});
    }, host);
  }
  async function decision(expected) {
    const deadline = Date.now() + timeout;
    let actual;
    do {
      actual = await status();
      if (actual.decision === expected) return actual;
      await page.waitForTimeout(30);
    } while (Date.now() < deadline);
    throw new Error(`Expected ${expected}; got ${JSON.stringify(actual)}`);
  }
  async function load({markup = html, styles = css, initialMode = 'auto'} = {}) {
    await mode('off');
    serve('/official-theme.html', markup, {type: 'text/html'});
    serve('/official-theme.css', styles);
    await page.goto(new URL(`/official-theme.html?case=${++serial}`, fixtureUrl).href, {waitUntil: 'domcontentloaded'});
    await decision('user-off');
    await mode(initialMode);
  }
  async function check(name, run) {
    const started = Date.now();
    console.error(`Official regression: ${name}`);
    await run();
    results.push({name, ok: true, durationMs: Date.now() - started, status: await status()});
  }
  const lightCss = css.replaceAll(':root[data-theme="dark"]', ':root[data-unused-theme="dark"]');
  const stylesheetMarkup = html.replace('data-theme="light"', 'data-site="alternate-fixture"');
  const darkCss = ':root, body, #official-theme-canvas, #official-theme-card { background: #0f1115; color: #eef1f5; color-scheme: dark; }';
  async function addStylesheet(url, disabled = true) {
    await page.evaluate(({url, disabled}) => {
      const link = document.createElement('link');
      link.id = 'alternate-dark';
      link.rel = 'alternate stylesheet';
      link.type = 'text/css';
      link.title = 'Dark';
      link.href = url;
      if (disabled !== 'default') link.disabled = disabled;
      document.head.append(link);
    }, {url, disabled});
  }
  try {
    for (const target of ['html', 'body']) {
      await check(`replacement ${target} gets a fresh budget for an identical recipe`, async () => {
        const selector = `${target}:not([data-broken])[data-theme="dark"]`;
        const markup = target === 'html'
          ? html.replace('data-theme="light"', 'data-theme="light" data-broken')
          : stylesheetMarkup.replace('<body>', '<body data-theme="light" data-broken>');
        const styles = css.replaceAll(':root[data-theme="dark"]', selector);
        await load({markup, styles, initialMode: 'off'});
        await page.evaluate(() => {
          globalThis.rootAttempts = 0;
          const observer = new MutationObserver((records) => {
            globalThis.rootAttempts += records.filter((record) => record.oldValue === 'light').length;
          });
          observer.observe(document, {attributes: true, subtree: true, attributeFilter: ['data-theme'], attributeOldValue: true});
        });
        await mode('auto');
        await decision('applied-light');
        await page.evaluate(() => document.documentElement.classList.add('route-two'));
        await page.waitForFunction((target) => globalThis.rootAttempts === 2 &&
          (target === 'html' ? document.documentElement : document.body).getAttribute('data-theme') === 'light', target);
        await decision('applied-light');
        await page.evaluate(({target, markup}) => {
          const parsed = new DOMParser().parseFromString(markup, 'text/html');
          const replacement = target === 'html' ? parsed.documentElement : parsed.body;
          replacement.removeAttribute('data-broken');
          (target === 'html' ? document.documentElement : document.body).replaceWith(replacement);
        }, {target, markup});
        await decision('official-dark');
        assert.equal(await page.evaluate((target) =>
          (target === 'html' ? document.documentElement : document.body).getAttribute('data-theme'), target), 'dark');
      });
    }
    for (const mutation of ['media', 'disabled']) {
      await check(`body-hosted stylesheet ${mutation} changes reconcile`, async () => {
        await load({markup: stylesheetMarkup, initialMode: 'off'});
        serve('/body-dark.css', darkCss);
        await page.evaluate(() => {
          const container = document.createElement('div');
          const link = document.createElement('link');
          link.id = 'body-dark'; link.rel = 'alternate stylesheet'; link.title = 'Dark';
          link.href = '/body-dark.css'; link.disabled = true;
          container.append(link); document.body.append(container);
        });
        await mode('auto');
        await decision('official-dark');
        if (mutation === 'media') {
          await page.evaluate(() => { document.getElementById('body-dark').media = 'print'; });
          await decision('applied-light');
        } else {
          await page.evaluate(() => { document.getElementById('body-dark').disabled = true; });
          await page.waitForFunction(() => !document.getElementById('body-dark').disabled, undefined, {timeout});
          await decision('official-dark');
        }
      });
    }
    for (const firstWorks of [true, false]) {
      await check(`dark variants stay exclusive; first candidate works=${firstWorks}`, async () => {
        await load({markup: stylesheetMarkup, initialMode: 'off'});
        serve('/variant-a.css', (firstWorks ? darkCss : '') + ':root {--variant-a: active;}');
        serve('/variant-c.css', ':root {--variant-c: active;}');
        serve('/variant-b.css', darkCss + ':root {--variant-b: active;}');
        await page.evaluate(() => {
          for (const [id, title] of [['a', 'Dark'], ['c', 'Dark'], ['b', 'Dark High Contrast']]) {
            const link = document.createElement('link');
            link.id = `variant-${id}`; link.rel = 'alternate stylesheet';
            link.title = title; link.href = `/variant-${id}.css`; link.disabled = true;
            document.head.append(link);
          }
        });
        await mode('auto');
        await decision('official-dark');
        assert.deepEqual(await page.evaluate(() => ({
          disabled: ['a', 'c', 'b'].map((id) => document.getElementById(`variant-${id}`).disabled),
          a: getComputedStyle(document.documentElement).getPropertyValue('--variant-a').trim(),
          b: getComputedStyle(document.documentElement).getPropertyValue('--variant-b').trim(),
          c: getComputedStyle(document.documentElement).getPropertyValue('--variant-c').trim(),
        })), firstWorks ? {disabled: [false, false, true], a: 'active', b: '', c: 'active'} :
          {disabled: [true, true, false], a: '', b: 'active', c: ''});
        await mode('off');
        await decision('user-off');
        assert.deepEqual(await page.evaluate(() => ['a', 'c', 'b'].map((id) => document.getElementById(`variant-${id}`).disabled)), [true, true, true]);
      });
    }
    await check('a new stylesheet is tried after the old candidate exhausts its failure budget', async () => {
      await load({styles: lightCss, initialMode: 'off'});
      await page.evaluate(() => {
        globalThis.failedMarkerAttempts = 0;
        const observer = new MutationObserver((records) => {
          globalThis.failedMarkerAttempts += records.filter((record) => record.oldValue === 'light').length;
        });
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme'], attributeOldValue: true});
      });
      await mode('auto');
      await decision('applied-light');
      await page.evaluate(() => document.documentElement.classList.add('route-two'));
      await page.waitForFunction(() => globalThis.failedMarkerAttempts === 2 && document.documentElement.dataset.theme === 'light');
      await decision('applied-light');
      await page.evaluate(() => document.documentElement.classList.add('route-three'));
      await decision('applied-light');
      assert.equal(await page.evaluate(() => globalThis.failedMarkerAttempts), 2);
      serve('/new-candidate.css', darkCss);
      await addStylesheet('/new-candidate.css');
      await decision('official-dark');
      assert.equal(await page.evaluate(() => document.getElementById('alternate-dark').disabled), false);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-semantic-dark-active')), false);
    });
    await check('prototype keys remain untouched through fallback', async () => {
      await load({markup: html.replace('data-theme="light"', 'data-theme="constructor" class="constructor __proto__"')});
      await decision('applied-light');
      assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.theme,
        document.documentElement.className]), ['constructor', 'constructor __proto__']);
      await mode('off');
      await decision('user-off');
      assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.theme,
        document.documentElement.className]), ['constructor', 'constructor __proto__']);
    });
    await check('successful official recovery survives repeated SPA route changes', async () => {
      await load();
      await decision('official-dark');
      for (let route = 0; route < 3; route += 1) {
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', undefined, {timeout});
        await decision('official-dark');
      }
    });
    for (const [attribute, initial, applied] of [['dark', 'false', 'true'], ['data-theme', 'day', 'night']]) {
      await check(`sparse official theme confirms ${attribute}=${applied}`, async () => {
        const selector = `:root[${attribute}="${applied}"]`;
        const markup = `<!doctype html><html ${attribute}="${initial}"><head><link rel="icon" href="data:,">
          <link rel="stylesheet" href="/official-theme.css"></head><body>
          <div class="unknown"></div><main id="safe">Sparse authored content</main><div class="unknown"></div>
          </body></html>`;
        const styles = `html,body {margin:0;min-height:100vh;background:white;color:#111;color-scheme:light;}
          body {display:grid;grid-template-columns:1fr 1fr 1fr;} #safe {background:white;color:#111;}
          .unknown {background-image:url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>');}
          ${selector}, ${selector} body, ${selector} #safe {background:#111;color:white;}`;
        await load({markup, styles});
        await decision('official-dark');
        assert.equal(await page.evaluate((name) => document.documentElement.getAttribute(name), attribute), applied);
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#safe')).backgroundColor), 'rgb(17, 17, 17)');
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-semantic-dark-active')), false);
      });
    }
    await check('duplicate stylesheet URLs preserve screen and print scopes', async () => {
      await load({markup: stylesheetMarkup, initialMode: 'off'});
      serve('/duplicate-dark.css', darkCss);
      await page.evaluate(() => {
        for (const [index, media] of ['none', 'print', 'print'].entries()) {
          const link = document.createElement('link');
          link.id = `duplicate-${index}`;
          link.rel = 'stylesheet'; link.title = 'Dark'; link.href = '/duplicate-dark.css';
          link.media = media; link.disabled = index === 2;
          document.head.append(link);
        }
      });
      await mode('auto');
      await decision('official-dark');
      const states = () => page.evaluate(() => [0, 1, 2].map((index) => {
        const link = document.getElementById(`duplicate-${index}`);
        return [link.media, link.disabled];
      }));
      assert.deepEqual(await states(), [['all', false], ['print', false], ['print', false]]);
      await mode('off');
      await decision('user-off');
      assert.deepEqual(await states(), [['none', false], ['print', false], ['print', true]]);
    });
    for (const [delayMs, expected, badge] of [[4500, 'applied-light', 'On'], [1700, 'official-dark', 'Site dark']]) {
      await check(`open popup settles after ${delayMs}ms CSS without reopening`, async () => {
        await load({markup: stylesheetMarkup, initialMode: 'off'});
        serve(`/popup-${delayMs}.css`, darkCss, {delayMs});
        await addStylesheet(`/popup-${delayMs}.css`);
        const popup = await context.newPage();
        try {
          await page.bringToFront();
          await popup.goto(`chrome-extension://${session.extensionId}/popup.html`);
          await popup.locator('#reset-mode').waitFor({state: 'visible', timeout});
          await popup.locator('#reset-mode').click();
          await decision(expected);
          await popup.waitForFunction((badge) =>
            document.querySelector('#site-state').textContent === badge &&
            !document.querySelector('#enabled').disabled &&
            document.querySelector('#popup').getAttribute('aria-busy') === 'false', badge, {timeout});
          await popup.screenshot({path: path.join(artifactDir, `popup-slow-${delayMs}.png`)});
        } finally {
          await popup.close();
          await page.bringToFront();
        }
      });
    }
    await check('SPA class additions/removals survive restore on both roots', async () => {
      await load({markup: html.replace('data-theme="light"', 'data-theme="light" class="light root-old"')
        .replace('<body>', '<body class="theme-light body-old">')});
      await decision('official-dark');
      await page.evaluate(() => {
        document.documentElement.classList.remove('root-old');
        document.documentElement.classList.add('spa-root');
        document.body.classList.remove('body-old');
        document.body.classList.add('modal-open');
      });
      await mode('off');
      await decision('user-off');
      const roots = await page.evaluate(() => ({
        html: [...document.documentElement.classList].sort(), body: [...document.body.classList].sort(),
        theme: document.documentElement.getAttribute('data-theme'),
      }));
      assert.deepEqual(roots, {html: ['light', 'spa-root'], body: ['modal-open', 'theme-light'], theme: 'light'});
    });
    await check('concurrent theme replacement survives pending activation rollback', async () => {
      await load();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'sepia';
        document.documentElement.className = 'new-route';
        document.body.className = 'new-body';
      });
      await mode('off');
      await decision('user-off');
      assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.theme,
        document.documentElement.className, document.body.className]), ['sepia', 'new-route', 'new-body']);
    });
    await check('replacement html/body retain SPA state and observer reattaches', async () => {
      await load();
      await decision('official-dark');
      await page.evaluate(() => {
        const next = document.documentElement.cloneNode(true);
        next.dataset.theme = 'light';
        next.className = 'route-new';
        next.querySelector('body').className = 'body-new';
        document.documentElement.replaceWith(next);
      });
      await mode('off');
      await decision('user-off');
      assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.theme,
        document.documentElement.className, document.body.className]), ['light', 'route-new', 'body-new']);
      await mode('auto');
      await decision('official-dark');
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await decision('official-dark');
    });
    await check('rapid auto/off/on/auto settles and old generations cannot roll back', async () => {
      await load();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      for (const next of ['off', 'auto', 'on', 'auto', 'off', 'on', 'auto']) await mode(next);
      await decision('official-dark');
      await page.waitForTimeout(400);
      assert.equal((await status()).decision, 'official-dark');
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-semantic-dark-active')), false);
    });
    await check('unsupported marker rolls back and transform remains stable', async () => {
      await load({styles: lightCss});
      await decision('applied-light');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
      await page.waitForTimeout(500);
      assert.equal((await status()).decision, 'applied-light');
    });
    await check('native-dark status updates after authored CSS turns light', async () => {
      await load({markup: stylesheetMarkup, styles: css + darkCss});
      await decision('native-dark');
      await page.evaluate((css) => {
        document.querySelector('link[href="/official-theme.css"]').remove();
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      }, lightCss);
      await decision('applied-light');
    });
    await check('alternate feeds/translations are untouched and never requested', async () => {
      const links = `
        <link id="feed" rel="alternate" type="application/rss+xml" title="Dark" href="/dark-feed.xml" media="none">
        <link id="translation" rel="alternate" hreflang="en" title="Night" href="/night-en.html" media="none">
        <link id="owned" data-semantic-dark-sheet rel="stylesheet" title="Dark" href="data:text/css," media="none">`;
      await load({markup: stylesheetMarkup.replace('</head>', links + '</head>')});
      await decision('applied-light');
      assert.deepEqual(await page.evaluate(() => ['feed', 'translation', 'owned'].map((id) => document.getElementById(id).media)), ['none', 'none', 'none']);
      assert.equal(requestCounts.get('/dark-feed.xml') ?? 0, 0);
      assert.equal(requestCounts.get('/night-en.html') ?? 0, 0);
    });
    await check('real slow alternate CSS settles without activation/load feedback', async () => {
      await load({markup: stylesheetMarkup, initialMode: 'off'});
      serve('/slow-dark.css', darkCss, {delayMs: 650});
      await addStylesheet('/slow-dark.css');
      await mode('auto');
      await page.waitForFunction(() => !document.getElementById('alternate-dark').disabled);
      assert.equal((await status()).decision, 'pending');
      await decision('official-dark');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 17, 21)');
      await page.waitForTimeout(400);
      assert.equal((await status()).decision, 'official-dark');
      assert.equal(requestCounts.get('/slow-dark.css'), 1);
      await mode('off');
      await decision('user-off');
      assert.equal(await page.evaluate(() => document.getElementById('alternate-dark').disabled), true);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    });
    await check('an active transform yields to a late official stylesheet', async () => {
      await load({markup: stylesheetMarkup});
      await decision('applied-light');
      serve('/late-dark.css', darkCss, {delayMs: 300});
      await addStylesheet('/late-dark.css');
      await decision('official-dark');
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-semantic-dark-active')), false);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 17, 21)');
    });
    await check('stylesheet replacement and third-party media changes survive restore', async () => {
      await load({markup: stylesheetMarkup, initialMode: 'off'});
      serve('/owned-dark.css', darkCss);
      await addStylesheet('/owned-dark.css');
      await mode('auto');
      await decision('official-dark');
      await page.evaluate(() => {
        const old = document.getElementById('alternate-dark');
        globalThis.originalOfficialSheet = old;
        const replacement = old.cloneNode();
        replacement.disabled = false;
        replacement.media = 'screen';
        old.replaceWith(replacement);
      });
      await mode('off');
      await decision('user-off');
      assert.deepEqual(await page.evaluate(() => ({
        originalDisabled: globalThis.originalOfficialSheet.disabled,
        replacementDisabled: document.getElementById('alternate-dark').disabled,
        media: document.getElementById('alternate-dark').media,
      })), {originalDisabled: true, replacementDisabled: false, media: 'screen'});
    });
    await check('system-light cancels CSS settlement and returning dark reconciles', async () => {
      await load({markup: stylesheetMarkup, initialMode: 'off'});
      serve('/system-dark.css', darkCss, {delayMs: 650});
      await addStylesheet('/system-dark.css');
      await mode('auto');
      await page.waitForFunction(() => !document.getElementById('alternate-dark').disabled);
      await page.emulateMedia({colorScheme: 'light'});
      await decision('system-light');
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => document.getElementById('alternate-dark').disabled), true);
      await page.emulateMedia({colorScheme: 'dark'});
      await decision('official-dark');
    });
    await check('pending CSS cancellation preserves newer off/on modes', async () => {
      for (const finalMode of ['off', 'on']) {
        await load({markup: stylesheetMarkup, initialMode: 'off'});
        serve('/cancel-dark.css', darkCss, {delayMs: 650});
        await addStylesheet('/cancel-dark.css');
        await mode('auto');
        await page.waitForFunction(() => !document.getElementById('alternate-dark').disabled);
        await mode(finalMode);
        await decision(`user-${finalMode}`);
        await page.waitForTimeout(900);
        assert.equal((await status()).decision, `user-${finalMode}`);
        assert.equal(await page.evaluate(() => document.getElementById('alternate-dark').disabled), true);
      }
    });
    await check('failed CSS load falls back without retaining the stylesheet', async () => {
      await load({markup: stylesheetMarkup, initialMode: 'off'});
      serve('/missing-dark.css', 'missing', {status: 404});
      await addStylesheet('/missing-dark.css');
      await mode('auto');
      await decision('applied-light');
      assert.equal(await page.evaluate(() => document.getElementById('alternate-dark').disabled), true);
    });
    await check('hung CSS reaches the bounded fallback and a late response stays disabled', async () => {
      await load({markup: stylesheetMarkup, initialMode: 'off'});
      serve('/timeout-dark.css', darkCss, {delayMs: 2800});
      await addStylesheet('/timeout-dark.css');
      await mode('auto');
      await decision('applied-light');
      assert.equal(await page.evaluate(() => document.getElementById('alternate-dark').disabled), true);
      await mode('off');
      await page.waitForTimeout(900);
      await decision('user-off');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    });
    await check('unselected default alternate stylesheet is left to fallback', async () => {
      await load({markup: stylesheetMarkup, initialMode: 'off'});
      serve('/default-dark.css', darkCss);
      await addStylesheet('/default-dark.css', 'default');
      await page.waitForTimeout(100);
      const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await mode('auto');
      await decision('applied-light');
      await mode('off');
      await decision('user-off');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), before);
    });
    assert.deepEqual(session.pageErrors, []);
    return {count: results.length, cases: results, requestCounts: Object.fromEntries(requestCounts), failedResponses};
  } catch (error) {
    error.message += `\nCompleted official-theme cases: ${JSON.stringify(results)}`;
    throw error;
  } finally {
    page.off('request', countRequest);
    page.off('response', recordResponse);
    routes.clear();
    for (const [url, value] of originalRoutes) routes.set(url, value);
  }
}
