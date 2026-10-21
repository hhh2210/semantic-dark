import {afterEach, describe, expect, it, vi} from 'vitest';
import {AuthoredThemeObserver} from '../../src/content/authored-theme-observer';

const observers: AuthoredThemeObserver[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.stop());
  document.head.innerHTML = '';
  document.body.removeAttribute('dark');
  document.body.removeAttribute('class');
});
function setup() {
  document.head.innerHTML = '<link rel="stylesheet" href="/site.css">';
  const changed = vi.fn();
  const observer = new AuthoredThemeObserver(changed);
  observers.push(observer);
  observer.start();
  return {observer, changed, link: document.querySelector('link')!};
}

describe('authored theme suspension', () => {
  it('suppresses mutations and load callbacks until the matching resume', async () => {
    const {observer, changed, link} = setup();
    observer.suspend();
    observer.suspend();
    link.dispatchEvent(new Event('load'));
    document.body.className = 'dark';
    observer.resume();
    link.dispatchEvent(new Event('load'));
    await tick();
    expect(changed).not.toHaveBeenCalled();
    observer.resume();
    await tick();
    expect(changed).not.toHaveBeenCalled(); // no replay of deliberately suppressed events
    link.dispatchEvent(new Event('load'));
    expect(changed).toHaveBeenCalledTimes(1);
    document.body.setAttribute('dark', 'false');
    await tick();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('reattaches to replacement containers on resume and stays stopped after stop', async () => {
    const {observer, changed, link} = setup();
    observer.suspend();
    const body = document.body;
    const replacement = document.createElement('body');
    body.replaceWith(replacement);
    try {
      observer.resume();
      replacement.className = 'light';
      await tick();
      expect(changed).toHaveBeenCalledTimes(1);
      observer.suspend();
      observer.stop();
      observer.resume();
      link.dispatchEvent(new Event('load'));
      replacement.className = 'dark';
      await tick();
      expect(changed).toHaveBeenCalledTimes(1);
      observer.start();
      link.dispatchEvent(new Event('load'));
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      replacement.replaceWith(body);
    }
  });

  it('observes a stylesheet losing its rel token but ignores feed load events', async () => {
    const {changed, link} = setup();
    link.rel = 'alternate';
    await tick();
    expect(changed).toHaveBeenCalledTimes(1);
    link.dispatchEvent(new Event('load'));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('ignores extension stylesheet attributes as well as its insertions and loads', async () => {
    const {changed} = setup();
    const style = document.createElement('style');
    style.setAttribute('data-semantic-dark-sheet', '');
    document.head.append(style);
    await tick();
    style.media = 'screen';
    style.textContent = 'body { color: red }';
    style.dispatchEvent(new Event('load'));
    await tick();
    expect(changed).not.toHaveBeenCalled();
  });
});
