import {describe, expect, it} from 'vitest';
import materialProtocol from '../../fixtures/paired-theme/material-v1.protocol.json';
import {materialThemePair, normalizedTokenHash} from '../../src/testing/paired-theme/material';
import {validateProtocol} from '../../src/testing/paired-theme/protocol';

describe('Material paired-theme adapter', () => {
  it('generates the frozen Tonal Spot light/dark semantic pairs', () => {
    const protocol = validateProtocol(materialProtocol);
    const theme = materialThemePair(protocol.source);
    expect(theme.tokens.canvas).toMatchObject({
      light: '#fdf7ff', dark: '#141218', sourceToken: 'background',
    });
    expect(theme.tokens.surfaceRaised).toMatchObject({
      light: '#ece6ee', dark: '#2b292f', sourceToken: 'surfaceContainerHigh',
    });
    expect(theme.tokens.textPrimary).toMatchObject({
      light: '#1d1b20', dark: '#e6e0e9', sourceToken: 'onSurface',
    });
    expect(theme.tokens.selectedSurface).toMatchObject({
      light: '#e9ddff', dark: '#4d3d75', sourceToken: 'primaryContainer',
    });
    expect(theme.tokens.dangerText).toMatchObject({
      light: '#93000a', dark: '#ffdad6', sourceToken: 'onErrorContainer',
    });
    expect(normalizedTokenHash(theme)).toBe(
      '36c230b6522756f56d97b95db95ddad18a92df69705540006e38e43799a208ca',
    );
  });
});
