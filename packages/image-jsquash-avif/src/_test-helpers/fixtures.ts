/**
 * Test fixtures for @catlabtech/webcvt-image-jsquash-avif.
 *
 * Generates minimal AVIF samples using the real @jsquash/avif wasm on first access.
 * Results are cached in module-level constants — no binary fixtures checked into the repo.
 *
 * These are used only in integration tests (real wasm round-trips).
 * Unit tests use mock-jsquash.ts instead.
 *
 * Note: makeSolidRedImageData etc. return plain objects satisfying ImageData interface
 * to work in both Node (no DOM) and browser environments.
 */

// ---------------------------------------------------------------------------
// ImageData-compatible plain object factory
// ---------------------------------------------------------------------------

/** Creates a plain object satisfying the ImageData interface (avoids DOM dependency). */
function makeImageDataLike(
  width: number,
  height: number,
  fill: (data: Uint8ClampedArray, width: number, height: number) => void,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  fill(data, width, height);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

// ---------------------------------------------------------------------------
// Helpers for creating ImageData test fixtures
// ---------------------------------------------------------------------------

/** Creates an 8×8 solid-red ImageData. */
export function makeSolidRedImageData(width = 8, height = 8): ImageData {
  return makeImageDataLike(width, height, (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255; // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = 255; // A
    }
  });
}

/** Creates a 16×16 RGBA gradient ImageData. */
export function makeGradientImageData(width = 16, height = 16): ImageData {
  return makeImageDataLike(width, height, (data, w, h) => {
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const idx = (row * w + col) * 4;
        data[idx] = Math.round((col / (w - 1)) * 255); // R varies by col
        data[idx + 1] = Math.round((row / (h - 1)) * 255); // G varies by row
        data[idx + 2] = 128; // B constant
        data[idx + 3] = 255; // A opaque
      }
    }
  });
}

/** Creates a 1×1 fully-transparent ImageData. */
export function makeTransparentImageData(): ImageData {
  return makeImageDataLike(1, 1, (_data) => {
    // All zeros = transparent black (default Uint8ClampedArray)
  });
}

// ---------------------------------------------------------------------------
// Encoded AVIF fixture (lazy-generated via real wasm)
// ---------------------------------------------------------------------------

let _solidRedAvif: Uint8Array | null = null;

/**
 * Returns an 8×8 solid-red AVIF encoded byte array.
 *
 * Generated on first call using the real @jsquash/avif wasm encode.
 * Subsequent calls return the cached result.
 *
 * Only use this in integration test files that import real wasm.
 */
export async function getSolidRedAvif(): Promise<Uint8Array> {
  if (_solidRedAvif !== null) {
    return _solidRedAvif;
  }

  // Dynamic import to avoid pulling wasm into unit test runs
  const jsquash = await import('@jsquash/avif');
  const imageData = makeSolidRedImageData();
  // @jsquash/avif encode returns ArrayBuffer; wrap in Uint8Array
  const buffer = await jsquash.encode(imageData, { speed: 10 });
  const encoded = new Uint8Array(buffer);
  _solidRedAvif = encoded;
  return encoded;
}

/** Clears the cached AVIF fixture (useful between test suites). */
export function clearFixtureCache(): void {
  _solidRedAvif = null;
}

// ---------------------------------------------------------------------------
// AVIF ftyp magic bytes — for quick format detection in tests
// ---------------------------------------------------------------------------

/** The 4-byte AVIF ftyp brand 'avif' in ASCII. */
export const AVIF_FTYP_BRAND = new Uint8Array([0x61, 0x76, 0x69, 0x66]); // 'a','v','i','f'

/**
 * Returns true when the byte array looks like an AVIF ftyp box.
 * Minimal check: bytes [4..7] should be 'ftyp'.
 */
export function looksLikeAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // bytes[4..7] = 'ftyp'
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}
