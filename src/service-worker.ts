import {
  normalizeThemeConfig,
  type RuntimeMessage,
  type ThemeConfig,
} from './types';

const keyFor = (host: string) => `semantic-dark:${host}`;

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'semantic-dark:get-config') {
    chrome.storage.local.get(keyFor(message.host)).then((record) => {
      sendResponse(normalizeThemeConfig(
        record[keyFor(message.host)] as Partial<ThemeConfig> | undefined,
      ));
    });
    return true;
  }

  if (message.type === 'semantic-dark:set-config') {
    const config = normalizeThemeConfig(message.config);
    chrome.storage.local.set({[keyFor(message.host)]: config}).then(async () => {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.map((tab) => tab.id == null ? Promise.resolve() :
        chrome.tabs.sendMessage(tab.id, {type: 'semantic-dark:config-changed', host: message.host, config})
      ));
      sendResponse(config);
    });
    return true;
  }
});
