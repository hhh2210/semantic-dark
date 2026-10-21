import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DEFAULT_THEME, type PageThemeStatus} from '../src/types';

let status: PageThemeStatus;
let read: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = readFileSync('extension/popup.html', 'utf8');
  status = {mode: 'auto', effectiveEnabled: false, decision: 'pending', reason: 'slow-css'};
  read = vi.fn(async () => ({...status}));
  vi.stubGlobal('chrome', {
    tabs: {query: vi.fn(async () => [{id: 1, url: 'https://example.com'}]), sendMessage: read},
    runtime: {sendMessage: vi.fn(async () => DEFAULT_THEME)},
  });
});
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'));
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('popup status refresh', () => {
  it('keeps checking through slow CSS and unlocks on the terminal decision', async () => {
    await import('../src/popup');
    await vi.advanceTimersByTimeAsync(2500);
    expect(document.querySelector('#site-state')?.textContent).toBe('Checking');
    expect(read.mock.calls.length).toBeGreaterThan(12);
    status = {...status, decision: 'applied-light', effectiveEnabled: true};
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('#site-state')?.textContent).toBe('On');
    expect(document.querySelector<HTMLInputElement>('#enabled')?.disabled).toBe(false);
    expect(document.querySelector('#popup')?.getAttribute('aria-busy')).toBe('false');
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(calls);
  });

  it('stops checking when the popup closes', async () => {
    await import('../src/popup');
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new Event('pagehide'));
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).toHaveBeenCalledTimes(calls);
  });
});
