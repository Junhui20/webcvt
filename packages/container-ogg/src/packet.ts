/**
 * Ogg lacing reassembly state machine.
 *
 * Lacing algorithm (RFC 3533 §6):
 *   packet_bytes = []
 *   for each entry len in segment_table:
 *       packet_bytes.append(next len bytes from body)
 *       if len < 255:
 *           emit packet(packet_bytes); packet_bytes = []
 *   If segment_table ends with 255, the packet continues on the next page.
 *
 * The PacketAssembler manages in-progress (continued) packet state across
 * page boundaries. It is instantiated once per logical stream.
 */

import { MAX_PACKETS_PER_STREAM, MAX_PACKET_BYTES } from './constants.ts';
import { OggPacketTooLargeError, OggTooManyPacketsError } from './errors.ts';
import type { OggPage } from './page.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OggPacket {
  /** Concatenated bytes after lacing reassembly. */
  readonly data: Uint8Array;
  /**
   * granule_position from the page where this packet ENDED.
   * -1n (0xFFFFFFFFFFFFFFFFn) if the packet spans pages and the end page
   * had granule_position = -1 (meaning no packet completed on that page).
   */
  readonly granulePosition: bigint;
  /** Logical stream serial number. */
  readonly serialNumber: number;
}

// ---------------------------------------------------------------------------
// PacketAssembler
// ---------------------------------------------------------------------------

/**
 * Stateful lacing reassembler for a single logical stream.
 *
 * Call `feedPage(page)` for each page in sequence. All completed packets are
 * returned. An in-progress (continued) packet is held internally until it
 * terminates on a later page.
 */
export class PacketAssembler {
  private readonly parts: Uint8Array[] = [];
  private inProgressSize = 0;
  private totalPackets = 0;
  private readonly serialNumber: number;

  constructor(serialNumber: number) {
    this.serialNumber = serialNumber;
  }

  /**
   * Feed an Ogg page and extract all completed packets from it.
   *
   * @returns Array of completed packets (may be empty if the packet continues).
   * @throws OggPacketTooLargeError — in-progress packet grew beyond 16 MiB.
   * @throws OggTooManyPacketsError — stream emitted more than MAX_PACKETS_PER_STREAM.
   */
  feedPage(page: OggPage): OggPacket[] {
    const completed: OggPacket[] = [];
    let bodyOffset = 0;

    for (let i = 0; i < page.segmentTable.length; i++) {
      const segLen = page.segmentTable[i] ?? 0;
      const segment = page.body.subarray(bodyOffset, bodyOffset + segLen);
      bodyOffset += segLen;

      // Accumulate segment into in-progress packet.
      if (segLen > 0) {
        this.inProgressSize += segLen;
        if (this.inProgressSize > MAX_PACKET_BYTES) {
          throw new OggPacketTooLargeError(this.inProgressSize, MAX_PACKET_BYTES);
        }
        this.parts.push(segment);
      } else {
        // Zero-byte segment still terminates a packet.
      }

      if (segLen < 255) {
        // Packet is complete — check cap BEFORE pushing so the offending packet
        // is rejected, not added then complained about (M-3 off-by-one fix).
        const packet = this.assemblePacket(page.granulePosition);
        if (packet !== null) {
          this.totalPackets++;
          if (this.totalPackets >= MAX_PACKETS_PER_STREAM) {
            throw new OggTooManyPacketsError(this.totalPackets, MAX_PACKETS_PER_STREAM);
          }
          completed.push(packet);
        }
      }
      // else: segLen === 255 → packet continues in next segment (or next page)
    }

    return completed;
  }

  /** Returns true if there is an in-progress packet waiting for more pages. */
  hasPendingPacket(): boolean {
    return this.parts.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private assemblePacket(granulePosition: bigint): OggPacket | null {
    if (this.parts.length === 0 && this.inProgressSize === 0) return null;

    let data: Uint8Array;
    if (this.parts.length === 1 && this.parts[0] !== undefined) {
      data = this.parts[0];
    } else {
      // Concatenate all accumulated parts.
      data = new Uint8Array(this.inProgressSize);
      let off = 0;
      for (const part of this.parts) {
        data.set(part, off);
        off += part.length;
      }
    }

    // Reset state.
    this.parts.length = 0;
    this.inProgressSize = 0;

    return {
      data,
      granulePosition,
      serialNumber: this.serialNumber,
    };
  }
}
