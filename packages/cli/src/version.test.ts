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

  it('returns the version from package.json (0.0.0 in development)', async () => {
    const version = await readPackageVersion();
    // In the monorepo dev environment, this is 0.0.0
    expect(version).toBe('0.0.0');
  });
});
