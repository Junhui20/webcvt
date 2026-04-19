/**
 * SubStation Alpha v4 (.ssa) parser and serializer.
 *
 * SSA is the predecessor to ASS. The main differences:
 *   - Styles section is "[V4 Styles]" instead of "[V4+ Styles]"
 *   - ScriptType is "v4.00" instead of "v4.00+"
 *   - Alignment uses a different numpad layout (SSA uses 1-11)
 *
 * This module delegates almost entirely to ass.ts, overriding the styles
 * section name and emitting the appropriate ScriptType on serialize.
 */

import { parseAss, serializeAss } from './ass.ts';
import type { SubtitleTrack } from './cue.ts';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a SubStation Alpha (.ssa) file into a SubtitleTrack.
 *
 * Delegates to parseAss with "[V4 Styles]" as the section name override.
 *
 * @param text - Raw SSA file contents.
 */
export function parseSsa(text: string): SubtitleTrack {
  return parseAss(text, { stylesSectionName: '[V4 Styles]' });
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a SubtitleTrack to SSA format.
 *
 * Replaces the "[V4+ Styles]" header with "[V4 Styles]" and sets
 * ScriptType to "v4.00" in the Script Info block.
 *
 * @param track - The SubtitleTrack to serialize.
 */
export function serializeSsa(track: SubtitleTrack): string {
  const raw = serializeAss(track, { stylesSectionName: '[V4 Styles]' });
  return raw.replace('ScriptType: v4.00+', 'ScriptType: v4.00');
}
