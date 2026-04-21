import { describe, expect, it } from 'vitest';
import { readPackageVersion } from './version.ts';

describe('readPackageVersion', () => {
  it('returns a semver-shaped string', async () => {
    const version = await readPackageVersion();
    expect(typeof version).toBe('string');
    // semver pattern: major.minor.patch (with optional prerelease/build)
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('does not throw', async () => {
    await expect(readPackageVersion()).resolves.toBeDefined();
  });

  it('returns the version from package.json', async () => {
    const version = await readPackageVersion();
    // Semver string read from the CLI's own package.json; pinned to the
    // minor so this test doesn't break on every patch bump.
    expect(version).toMatch(/^0\.1\.\d+/);
  });
});
