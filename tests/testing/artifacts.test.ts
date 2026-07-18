import {homedir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  resolveScratchOutput,
  serializeCanonicalJson,
  sha256Text,
} from '../../src/testing/artifacts';

describe('testing artifact utilities', () => {
  it('accepts only explicit scratch-data subdirectories', () => {
    expect(resolveScratchOutput('~/scratch-data/semantic-dark-test', 'Test')).toBe(
      path.join(homedir(), 'scratch-data', 'semantic-dark-test'),
    );
    expect(() => resolveScratchOutput('~/scratch-data', 'Test')).toThrow(
      'Test output must be a subdirectory',
    );
    expect(() => resolveScratchOutput('/tmp/semantic-dark-test', 'Test')).toThrow(
      'Test output must be a subdirectory',
    );
  });

  it('serializes objects canonically while preserving array order', () => {
    const first = serializeCanonicalJson({z: 1, a: {y: 2, x: [3, 1]}});
    const second = serializeCanonicalJson({a: {x: [3, 1], y: 2}, z: 1});
    expect(first).toBe(second);
    expect(first).toBe('{\n  "a": {\n    "x": [\n      3,\n      1\n    ],\n    "y": 2\n  },\n  "z": 1\n}\n');
  });

  it('rejects values that cannot produce a reproducible JSON artifact', () => {
    expect(() => serializeCanonicalJson({bad: Number.NaN})).toThrow('Non-finite number');
    expect(() => serializeCanonicalJson({bad: undefined})).toThrow('Undefined value');
  });

  it('hashes exact serialized bytes', () => {
    expect(sha256Text('semantic-dark\n')).toBe(
      'b510e4d7cf1d41c6ea9f12069293ded510c7b8fbf54461f1d7547b45fa88d39a',
    );
  });
});
