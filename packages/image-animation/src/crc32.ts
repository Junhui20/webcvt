/**
 * CRC-32 implementation using the PNG polynomial 0xEDB88320 (reflected form
 * of 0x04C11DB7). Table is built lazily on first use.
 *
 * PNG spec: CRC-32 is computed over the chunk TYPE bytes + chunk DATA bytes
 * (NOT the 4-byte length prefix, NOT the CRC field itself). See Trap §8.
 */

let table: Uint32Array | undefined;

function getTable(): Uint32Array {
  if (table === undefined) {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c;
    }
    table = t;
  }
  return table;
}

/**
 * Compute CRC-32 over a byte slice.
 *
 * @param data - The bytes to checksum.
 * @param initial - Starting CRC value (default 0xFFFFFFFF for fresh computation).
 * @returns The final CRC-32 as an unsigned 32-bit integer.
 */
export function crc32(data: Uint8Array, initial = 0xffffffff): number {
  const t = getTable();
  let c = initial;
  for (let i = 0; i < data.length; i++) {
    // data[i] is always defined (i < data.length); t[...&0xff] always defined (table has 256 entries)
    /* v8 ignore next 1 — ?? 0 fallbacks are structurally unreachable: i is bounded by data.length, index masked to 0–255 */
    c = (t[(c ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Compute CRC-32 over two concatenated byte slices without allocation.
 * Used for PNG chunks where we need CRC over (type_bytes + data_bytes).
 */
export function crc32Two(a: Uint8Array, b: Uint8Array): number {
  const t = getTable();
  let c = 0xffffffff;
  for (let i = 0; i < a.length; i++) {
    // a[i] is always defined (i < a.length); t[...&0xff] always defined (table has 256 entries)
    /* v8 ignore next 1 — ?? 0 fallbacks are structurally unreachable: i is bounded by a.length, index masked to 0–255 */
    c = (t[(c ^ (a[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  for (let i = 0; i < b.length; i++) {
    // b[i] is always defined (i < b.length); t[...&0xff] always defined (table has 256 entries)
    /* v8 ignore next 1 — ?? 0 fallbacks are structurally unreachable: i is bounded by b.length, index masked to 0–255 */
    c = (t[(c ^ (b[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
