import {describe, expect, it, vi} from 'vitest';
import {
  disabledHostPatterns,
  PREPAINT_SCRIPT_ID,
  prepaintRegistration,
  prepaintScript,
  type PrepaintRegistrationApi,
} from '../src/prepaint-registration';

describe('disabledHostPatterns', () => {
  it('excludes exactly the hosts whose stored mode is off', () => {
    expect(disabledHostPatterns({
      'semantic-dark:off.example': {mode: 'off'},
      'semantic-dark:legacy.example': {enabled: false},
      'semantic-dark:auto.example': {mode: 'auto'},
      'semantic-dark:on.example': {mode: 'on'},
      'semantic-dark:default.example': {},
      'unrelated:off.example': {mode: 'off'},
    })).toEqual(['*://off.example/*', '*://legacy.example/*']);
  });

  it('excludes every port of a disabled host, since Chrome rejects ports in patterns', () => {
    expect(disabledHostPatterns({
      'semantic-dark:localhost:8080': {mode: 'off'},
      'semantic-dark:localhost:3000': {mode: 'off'},
      'semantic-dark:Example.COM': {mode: 'off'},
      'semantic-dark:[::1]:3000': {mode: 'off'},
      'semantic-dark:127.0.0.1': {mode: 'off'},
    })).toEqual(['*://localhost/*', '*://example.com/*', '*://[::1]/*', '*://127.0.0.1/*']);
  });

  it('never emits a host that could change the pattern syntax', () => {
    expect(disabledHostPatterns({
      'semantic-dark:*.example': {mode: 'off'},
      'semantic-dark:a.example/path': {mode: 'off'},
      'semantic-dark:': {mode: 'off'},
    })).toEqual([]);
  });
});

describe('prepaintScript', () => {
  it('runs at document_start in top-level http(s) pages only', () => {
    expect(prepaintScript({'semantic-dark:off.example': {mode: 'off'}})).toEqual({
      id: PREPAINT_SCRIPT_ID,
      js: ['prepaint.js'],
      matches: ['http://*/*', 'https://*/*'],
      excludeMatches: ['*://off.example/*'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    });
  });
});

function fakeApi(records: Record<string, unknown>) {
  const registered = new Map<string, chrome.scripting.RegisteredContentScript>();
  const calls: string[] = [];
  const api = {
    storage: {get: async () => ({...records})},
    scripting: {
      getRegisteredContentScripts: async (filter?: chrome.scripting.ContentScriptFilter) => {
        calls.push('get');
        return [...registered.values()].filter((script) => filter?.ids?.includes(script.id) ?? true);
      },
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        calls.push('register');
        for (const script of scripts) {
          if (registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
          registered.set(script.id, script);
        }
      },
      updateContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        calls.push('update');
        for (const script of scripts) registered.set(script.id, {...registered.get(script.id)!, ...script});
      },
      unregisterContentScripts: async (filter?: chrome.scripting.ContentScriptFilter) => {
        calls.push('unregister');
        for (const id of filter?.ids ?? []) registered.delete(id);
      },
    },
  };
  return {api: api as unknown as PrepaintRegistrationApi, records, registered, calls};
}

describe('prepaintRegistration', () => {
  it('registers once, then updates the exclusions as hosts are toggled', async () => {
    const state = fakeApi({});
    const sync = prepaintRegistration(state.api);
    await sync();
    expect(state.registered.get(PREPAINT_SCRIPT_ID)?.excludeMatches).toEqual([]);

    state.records['semantic-dark:off.example'] = {mode: 'off'};
    await sync();
    expect(state.registered.get(PREPAINT_SCRIPT_ID)?.excludeMatches).toEqual(['*://off.example/*']);
    expect(state.calls).toEqual(['get', 'register', 'get', 'update']);
  });

  it('serializes overlapping syncs so they never register the same id twice', async () => {
    const state = fakeApi({});
    const sync = prepaintRegistration(state.api);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await Promise.all([sync(), sync(), sync()]);
    expect(warn).not.toHaveBeenCalled();
    expect(state.calls.filter((call) => call === 'register')).toHaveLength(1);
    warn.mockRestore();
  });

  it('unregisters a stale script when an update fails', async () => {
    const state = fakeApi({});
    const sync = prepaintRegistration(state.api);
    await sync();
    state.api.scripting.updateContentScripts = async () => { throw new Error('Invalid url pattern'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.records['semantic-dark:off.example'] = {mode: 'off'};
    await sync();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(state.registered.size).toBe(0);
    warn.mockRestore();
  });
});
