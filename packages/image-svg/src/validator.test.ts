/**
 * Tests for validator.ts — string-based SVG security reject pass.
 *
 * All checks must fire BEFORE DOMParser invocation, so these tests exercise
 * pure string matching with no DOM dependency.
 */

import { describe, expect, it } from 'vitest';
import { SvgUnsafeContentError } from './errors.ts';
import { validateSvgSecurity } from './validator.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';

// ---------------------------------------------------------------------------
// Clean pass
// ---------------------------------------------------------------------------

describe('validateSvgSecurity — safe document', () => {
  it('does not throw for a minimal safe SVG', () => {
    expect(() => {
      validateSvgSecurity(SAFE_SVG);
    }).not.toThrow();
  });

  it('does not throw for an SVG with a fragment-only href', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><use href="#icon"/></svg>';
    expect(() => {
      validateSvgSecurity(svg);
    }).not.toThrow();
  });

  it('does not throw for an SVG with xlink:href pointing to a fragment', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#icon"/></svg>';
    expect(() => {
      validateSvgSecurity(svg);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Trap §1 + §2: <!ENTITY
// ---------------------------------------------------------------------------

describe('validateSvgSecurity — <!ENTITY rejection (Trap §1, §2)', () => {
  it('rejects document containing <!ENTITY xxe SYSTEM ...>', () => {
    const svg = `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects document with internal entity (billion-laughs pattern)', () => {
    const svg = `<!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><svg xmlns="http://www.w3.org/2000/svg">&lol2;</svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('error.pattern contains <!ENTITY', () => {
    const svg = `before <!ENTITY bad SYSTEM "x"> after`;
    const err = (() => {
      try {
        validateSvgSecurity(svg);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(SvgUnsafeContentError);
    expect((err as SvgUnsafeContentError).pattern).toContain('<!ENTITY');
  });
});

// ---------------------------------------------------------------------------
// Trap §1: <!DOCTYPE
// ---------------------------------------------------------------------------

describe('validateSvgSecurity — <!DOCTYPE rejection (Trap §1)', () => {
  it('rejects document containing <!DOCTYPE svg [...]> internal subset', () => {
    const svg = `<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects bare <!DOCTYPE svg> even without entity', () => {
    const svg = `<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });
});

// ---------------------------------------------------------------------------
// Trap §4: <script
// ---------------------------------------------------------------------------

describe('validateSvgSecurity — <script rejection (Trap §4)', () => {
  it('rejects document containing <script> tag (lowercase)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects document containing <SCRIPT> tag (uppercase)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects document containing <Script> tag (mixed case)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><Script>alert(1)</Script></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects document containing <script with newline', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script\ntype="text/javascript">alert(1)</script></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });
});

// ---------------------------------------------------------------------------
// Trap §5: <foreignObject
// ---------------------------------------------------------------------------

describe('validateSvgSecurity — <foreignObject rejection (Trap §5)', () => {
  it('rejects document containing <foreignObject>', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects document containing <FOREIGNOBJECT> (uppercase)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><FOREIGNOBJECT></FOREIGNOBJECT></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });
});

// ---------------------------------------------------------------------------
// Trap §3 + §6: external href / xlink:href
// ---------------------------------------------------------------------------

describe('validateSvgSecurity — external href rejection (Trap §3, §6)', () => {
  it('rejects external href on <image> with http scheme', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="http://attacker.com/x.png"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects external href on <use> with https scheme', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.com/sprite.svg#icon"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects data: URI href', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,abc"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects file: URI href', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects relative path href (not starting with #)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="images/photo.png"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('rejects xlink:href with http scheme (deprecated form, Trap §6)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="http://evil.com/sprite.svg#icon"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).toThrow(SvgUnsafeContentError);
  });

  it('accepts intra-document fragment href starting with #', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><use href="#mySymbol"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).not.toThrow();
  });

  it('accepts xlink:href with # fragment', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#mySymbol"/></svg>`;
    expect(() => {
      validateSvgSecurity(svg);
    }).not.toThrow();
  });
});
