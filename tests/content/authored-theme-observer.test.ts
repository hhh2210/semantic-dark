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

it('observes stylesheet attributes and style text in nested body containers', async () => {
  const {changed} = setup();
  const container = document.createElement('div');
  container.innerHTML = '<link rel="stylesheet" href="/body.css"><style>body {color:black}</style>';
  document.body.append(container);
  await tick();
  changed.mockClear();
  const link = container.querySelector('link')!;
  try {
    for (const [name, value] of [['disabled', ''], ['media', 'print'], ['href', '/next.css'], ['rel', 'alternate']]) {
      link.setAttribute(name!, value!);
      await tick();
      expect(changed).toHaveBeenCalledTimes(1);
      changed.mockClear();
    }
    container.querySelector('style')!.firstChild!.nodeValue = 'body {color:white}';
    await tick();
    expect(changed).toHaveBeenCalledTimes(1);
  } finally { container.remove(); }
});

it('ignores unrelated body metadata and extension-owned style text', async () => {
  const {changed} = setup();
  const container = document.createElement('div');
  container.innerHTML = '<a href="/first">link</a><input><span>text</span><div data-semantic-dark-ui><style>body {color:black}</style></div>';
  document.body.append(container);
  await tick();
  changed.mockClear();
  try {
    document.body.setAttribute('title', 'tooltip');
    container.querySelector('a')!.href = '/second';
    container.querySelector('input')!.disabled = true;
    container.querySelector('span')!.firstChild!.nodeValue = 'updated';
    container.querySelector('style')!.firstChild!.nodeValue = 'body {color:white}';
    await tick();
    expect(changed).not.toHaveBeenCalled();
  } finally { container.remove(); document.body.removeAttribute('title'); }
});

it('distinguishes style invalidation from unrelated root-class and body text changes', async () => {
  const {changed} = setup();
  document.body.classList.add('route');
  await tick();
  expect(changed).toHaveBeenLastCalledWith(false);
  const style = document.createElement('style');
  style.textContent = 'body {color:white}';
  document.body.append(style);
  await tick();
  expect(changed).toHaveBeenLastCalledWith(true);
  style.textContent = '';
  await tick();
  expect(changed).toHaveBeenLastCalledWith(true);
  const text = document.createTextNode('body text');
  document.body.append(text);
  await tick();
  expect(changed).toHaveBeenLastCalledWith(false);
  text.remove();
  style.remove();
});
