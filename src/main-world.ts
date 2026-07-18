const EVENT_NAME = 'semantic-dark:page-style-changed';

const notify = () => document.dispatchEvent(new CustomEvent(EVENT_NAME));

for (const method of ['insertRule', 'deleteRule', 'replace', 'replaceSync'] as const) {
  const original = CSSStyleSheet.prototype[method] as (...args: unknown[]) => unknown;
  Object.defineProperty(CSSStyleSheet.prototype, method, {
    configurable: true,
    writable: true,
    value: function (...args: unknown[]) {
      const result = original.apply(this, args);
      if (result instanceof Promise) result.finally(notify);
      else queueMicrotask(notify);
      return result;
    },
  });
}

const originalAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init: ShadowRootInit) {
  const root = originalAttachShadow.call(this, init);
  queueMicrotask(notify);
  return root;
};
