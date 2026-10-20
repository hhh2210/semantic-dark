/**
 * Rewrite page-authored `http:` media URLs to `https:` before engines force loads.
 * Only secure pages produce Mixed Content warnings; `http:` pages are left untouched
 * because their media hosts (for example local servers) may not serve TLS at all.
 */

const MEDIA_SELECTOR = 'img, source, video, audio, image';

export function upgradeInsecureUrl(value: string, base = location.href): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return value;
  try {
    if (new URL(base).protocol !== 'https:') return value;
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:') return value;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return value;
  }
}

/** Upgrade each candidate URL in a `srcset` descriptor list. */
export function upgradeInsecureSrcset(value: string, base = location.href): string {
  return value.replace(/(?:^|,)\s*([^\s,]+)/g, (match, candidate: string) =>
    match.replace(candidate, upgradeInsecureUrl(candidate, base)));
}

function upgradeAttribute(
  element: Element,
  name: string,
  upgrade: (value: string) => string,
): boolean {
  const current = element.getAttribute(name);
  if (current == null) return false;
  const next = upgrade(current);
  if (next === current) return false;
  element.setAttribute(name, next);
  return true;
}

function upgradeMediaElement(element: Element): number {
  let changed = 0;
  if (upgradeAttribute(element, 'src', upgradeInsecureUrl)) changed += 1;
  if (upgradeAttribute(element, 'srcset', upgradeInsecureSrcset)) changed += 1;
  if (upgradeAttribute(element, 'href', upgradeInsecureUrl)) changed += 1;
  if (upgradeAttribute(element, 'xlink:href', upgradeInsecureUrl)) changed += 1;
  return changed;
}

/** Upgrade insecure media URLs under `root`, including `root` itself when it is media. */
export function upgradeInsecureMedia(root: ParentNode = document): number {
  let changed = 0;
  if (root instanceof Element && root.matches(MEDIA_SELECTOR)) {
    changed += upgradeMediaElement(root);
  }
  for (const element of root.querySelectorAll(MEDIA_SELECTOR)) {
    changed += upgradeMediaElement(element);
  }
  return changed;
}

/** Keep upgrading media as the page mutates. Returns a disconnect callback. */
export function observeInsecureMedia(root: Document | Element = document): () => void {
  if (location.protocol !== 'https:') return () => undefined;
  upgradeInsecureMedia(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        if (record.target.matches(MEDIA_SELECTOR)) upgradeMediaElement(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) upgradeInsecureMedia(node);
      }
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'href'],
  });
  return () => observer.disconnect();
}
