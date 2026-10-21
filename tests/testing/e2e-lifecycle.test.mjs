// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
vi.mock('playwright', () => ({chromium: {launch: vi.fn()}}));
import {chromium} from 'playwright';
import {captureBaseline} from '../../src/testing/e2e/chrome-session.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

describe('E2E browser lifetime', () => {
  it('awaits the first browser close when abort and finally both request cleanup', async () => {
    const navigation = deferred();
    const closing = deferred();
    const goto = vi.fn(() => navigation.promise);
    const close = vi.fn().mockReturnValueOnce(closing.promise).mockResolvedValue(undefined);
    chromium.launch.mockResolvedValue({newPage: async () => ({goto}), close});
    const abort = new AbortController();
    let finished = false;
    const running = captureBaseline({signal: abort.signal}).catch((error) => {
      finished = true;
      return error;
    });
    await vi.waitFor(() => expect(goto).toHaveBeenCalled());
    abort.abort();
    navigation.reject(new Error('page closed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    closing.resolve();
    expect((await running).message).toBe('page closed');
  });

  it('closes a browser acquired after cancellation before reporting completion', async () => {
    const acquisition = deferred();
    const closing = deferred();
    const close = vi.fn(() => closing.promise);
    chromium.launch.mockReturnValue(acquisition.promise);
    const abort = new AbortController();
    let finished = false;
    const running = captureBaseline({signal: abort.signal}).catch((error) => {
      finished = true;
      return error;
    });
    abort.abort(new Error('test deadline'));
    acquisition.resolve({close});
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(finished).toBe(false);
    closing.resolve();
    expect((await running).message).toBe('test deadline');
  });
});
