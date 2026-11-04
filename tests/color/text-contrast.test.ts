import {describe, expect, it} from 'vitest';
import {parseCssColor, rgba8ContrastRatios, mapCssGradient} from '../../src/color';
import {darkenGradientForText} from '../../src/color/gradient';
import {textColorForBackdrops} from '../../src/color/text-contrast';

describe('mapped text against its actual surface range', () => {
  it('repairs inherited white text on a medium mapped surface without inverting it', () => {
    const text = parseCssColor('#fff')!, background = parseCssColor('#858585')!;
    expect(rgba8ContrastRatios(text, background).minimum).toBeLessThan(4.5);
    const repaired = textColorForBackdrops(text, [background], 4.5)!;
    expect(rgba8ContrastRatios(repaired, background).minimum).toBeGreaterThanOrEqual(4.5);
  });

  it('checks the darker end of a light gradient as well as the brighter end', () => {
    const backgrounds = ['#d6d6d6', '#bbbbbb'].map(value => parseCssColor(value)!);
    const text = textColorForBackdrops(parseCssColor('#5c5c5c')!, backgrounds, 4.5)!;
    for (const bg of backgrounds) expect(rgba8ContrastRatios(text, bg).minimum).toBeGreaterThanOrEqual(4.5);
  });

  it('detects impossible ranges and shades their geometry so one foreground can pass', () => {
    const gradient = mapCssGradient('linear-gradient(#fff, #000)', '#111416')!;
    expect(textColorForBackdrops(parseCssColor('#888')!, gradient.readabilityBackgrounds.map(c => parseCssColor(c)!), 4.5)).toBeNull();
    const shaded = darkenGradientForText(gradient, 4.5);
    expect(shaded.css.endsWith(gradient.css)).toBe(true);
    const backgrounds = shaded.readabilityBackgrounds.map(c => parseCssColor(c)!);
    const text = textColorForBackdrops(parseCssColor('#888')!, backgrounds, 4.5)!;
    expect(text).not.toBeNull();
    for (const bg of backgrounds) expect(rgba8ContrastRatios(text, bg).minimum).toBeGreaterThanOrEqual(4.5);
  });
});
