import {describe, expect, it} from 'vitest';
import {darkClassForLightClass, darkValueForThemeToken} from '../../src/content/theme-markers';

describe('theme marker maps', () => {
  it('rejects inherited object keys without corrupting known mappings', () => {
    for (const value of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'CONSTRUCTOR']) {
      expect(darkClassForLightClass(value)).toBeNull();
      expect(darkValueForThemeToken(value)).toBeNull();
    }
    expect(darkClassForLightClass('THEME-LIGHT')).toBe('theme-dark');
    expect(darkValueForThemeToken(' Day ')).toBe('night');
  });
});
