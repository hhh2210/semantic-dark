import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {claimDarkBase, paintDarkBase, PREPAINT_ATTRIBUTE} from '../../src/content/prepaint';

function prefersDark(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' && matches,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  delete (globalThis as Record<string, unknown>).__semanticDarkPrepaintClaimed;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(PREPAINT_ATTRIBUTE);
});

describe('paintDarkBase', () => {
  it('paints the base only while the system prefers dark', () => {
    prefersDark(false);
    paintDarkBase();
    expect(document.documentElement.hasAttribute(PREPAINT_ATTRIBUTE)).toBe(false);

    prefersDark(true);
    paintDarkBase();
    expect(document.documentElement.hasAttribute(PREPAINT_ATTRIBUTE)).toBe(true);
  });

  it('drops an unclaimed base, so a failed content script cannot strand the page', () => {
    prefersDark(true);
    paintDarkBase();
    vi.advanceTimersByTime(9_999);
    expect(document.documentElement.hasAttribute(PREPAINT_ATTRIBUTE)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(document.documentElement.hasAttribute(PREPAINT_ATTRIBUTE)).toBe(false);
  });

  it('leaves a claimed base to the controller', () => {
    prefersDark(true);
    paintDarkBase();
    claimDarkBase();
    vi.advanceTimersByTime(60_000);
    expect(document.documentElement.hasAttribute(PREPAINT_ATTRIBUTE)).toBe(true);
  });
});
