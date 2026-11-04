import {afterEach, expect, it, vi} from 'vitest';
import {DEFAULT_THEME} from '../src/types';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('acknowledges a disabled host only after its document-start exclusion is installed', async () => {
  let receive: (message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean;
  let finishRegistration!: () => void;
  const records: Record<string, unknown> = {};
  const register = vi.fn(async () => new Promise<void>((resolve) => { finishRegistration = resolve; }));
  const query = vi.fn(async () => []);
  vi.stubGlobal('chrome', {
    runtime: {onInstalled: {addListener() {}}, onStartup: {addListener() {}},
      onMessage: {addListener(listener: typeof receive) { receive = listener; }}},
    storage: {onChanged: {addListener() {}}, local: {
      get: async () => records,
      set: async (values: Record<string, unknown>) => { Object.assign(records, values); },
    }},
    scripting: {getRegisteredContentScripts: async () => [], registerContentScripts: register,
      updateContentScripts: vi.fn(), unregisterContentScripts: vi.fn()},
    tabs: {query, sendMessage: vi.fn()},
  });
  await import('../src/service-worker');
  const reply = vi.fn();
  expect(receive!({type: 'semantic-dark:set-config', host: 'off.example',
    config: {...DEFAULT_THEME, mode: 'off', enabled: false}}, {}, reply)).toBe(true);
  await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
  expect(register.mock.calls[0]).toEqual([[expect.objectContaining({excludeMatches: ['*://off.example/*']})]]);
  expect(reply).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  finishRegistration();
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({mode: 'off'})));
});
