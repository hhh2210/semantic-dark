/** Root marker of the dark base painted before the first theme decision. */
export const PREPAINT_ATTRIBUTE = 'data-semantic-dark-prepaint';

// The document_start script and content.js share this extension's isolated
// world, so a global (invisible to the page) tells the first that the second
// has taken over the base.
const CLAIM_KEY = '__semanticDarkPrepaintClaimed';
// Far longer than any probe takes to start: only a content script that never
// constructed its controller leaves the base unclaimed this long.
const UNCLAIMED_TIMEOUT_MS = 10_000;

/** Paints the base for a dark system, and drops it again if nothing claims it. */
export function paintDarkBase(root: HTMLElement = document.documentElement): void {
  if (!matchMedia('(prefers-color-scheme: dark)').matches) return;
  root.setAttribute(PREPAINT_ATTRIBUTE, '');
  setTimeout(() => {
    if (!isDarkBaseClaimed()) root.removeAttribute(PREPAINT_ATTRIBUTE);
  }, UNCLAIMED_TIMEOUT_MS);
}

export function claimDarkBase(): void {
  (globalThis as unknown as Record<string, unknown>)[CLAIM_KEY] = true;
}

function isDarkBaseClaimed(): boolean {
  return (globalThis as unknown as Record<string, unknown>)[CLAIM_KEY] === true;
}
