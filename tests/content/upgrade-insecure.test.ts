import {afterEach, describe, expect, it} from 'vitest';
import {
  observeInsecureMedia,
  upgradeInsecureMedia,
  upgradeInsecureSrcset,
  upgradeInsecureUrl,
} from '../../src/content/upgrade-insecure';

afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('upgradeInsecureUrl', () => {
  it('rewrites http URLs to https and leaves other schemes alone', () => {
    expect(upgradeInsecureUrl('http://cdn.example/a.jpg', 'https://app.example/'))
      .toBe('https://cdn.example/a.jpg');
    expect(upgradeInsecureUrl('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(upgradeInsecureUrl('data:image/png;base64,xx')).toBe('data:image/png;base64,xx');
    expect(upgradeInsecureUrl('blob:https://app.example/1')).toBe('blob:https://app.example/1');
  });
});

describe('upgradeInsecureSrcset', () => {
  it('upgrades each candidate URL in a srcset list', () => {
    expect(upgradeInsecureSrcset(
      'http://cdn.example/a.jpg 1x, http://cdn.example/a@2x.jpg 2x',
      'https://app.example/',
    )).toBe('https://cdn.example/a.jpg 1x, https://cdn.example/a@2x.jpg 2x');
  });
});

describe('upgradeInsecureMedia', () => {
  it('rewrites img src and srcset under a root', () => {
    document.body.innerHTML = `
      <img id="cover" src="http://sns.example/spectrum/note.jpg"
           srcset="http://sns.example/a.jpg 1x, https://sns.example/b.jpg 2x">
      <img id="safe" src="https://sns.example/ok.jpg">
    `;
    expect(upgradeInsecureMedia(document)).toBe(2);
    const cover = document.getElementById('cover') as HTMLImageElement;
    expect(cover.getAttribute('src')).toBe('https://sns.example/spectrum/note.jpg');
    expect(cover.getAttribute('srcset'))
      .toBe('https://sns.example/a.jpg 1x, https://sns.example/b.jpg 2x');
    expect(document.getElementById('safe')!.getAttribute('src'))
      .toBe('https://sns.example/ok.jpg');
  });

  it('rewrites SVG image href attributes', () => {
    document.body.innerHTML = `
      <svg>
        <image id="graphic" href="http://cdn.example/mark.png"></image>
      </svg>
    `;
    expect(upgradeInsecureMedia(document)).toBe(1);
    expect(document.getElementById('graphic')!.getAttribute('href'))
      .toBe('https://cdn.example/mark.png');
  });
});

describe('observeInsecureMedia', () => {
  it('upgrades media added after the observer starts', async () => {
    const stop = observeInsecureMedia(document);
    const image = document.createElement('img');
    image.setAttribute('src', 'http://cdn.example/late.jpg');
    document.body.append(image);
    await Promise.resolve();
    expect(image.getAttribute('src')).toBe('https://cdn.example/late.jpg');
    stop();
  });
});
