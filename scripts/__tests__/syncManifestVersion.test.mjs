import { describe, expect, test } from 'vitest';

import { toManifestVersion } from '../syncManifestVersion.mjs';

describe('toManifestVersion', () => {
  test('keeps stable semantic versions unchanged', () => {
    expect(toManifestVersion('7.1.1')).toBe('7.1.1');
  });

  test.each([
    ['7.1.1-beta.0', '7.1.0.1'],
    ['7.1.1-beta.1', '7.1.0.2'],
    ['7.2.0-beta.0', '7.1.65535.1'],
    ['8.0.0-beta.0', '7.65535.65535.1'],
  ])('maps %s below its target stable extension version', (packageVersion, expected) => {
    expect(toManifestVersion(packageVersion)).toBe(expected);
  });

  test.each(['7.1.1-beta', '7.1.1-beta.65535', '0.0.0-beta.0'])(
    'rejects unsupported prerelease %s',
    (packageVersion) => {
      expect(() => toManifestVersion(packageVersion)).toThrow();
    },
  );
});
