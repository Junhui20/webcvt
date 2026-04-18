/**
 * Intermediate representation shared by all subtitle parsers and serializers.
 *
 * Text uses plain Unicode with \n for line breaks. Format-specific styling
 * (ASS override tags, HTML inline tags) is stripped on parse unless preserved
 * in the optional `style` field.
 */

export interface CueStyle {
  /** Font family name. */
  fontName?: string;
  /** Font size in points. */
  fontSize?: number;
  /** Primary colour as 0xAABBGGRR (ASS convention) or CSS hex string. */
  primaryColor?: string;
  /** Secondary colour (ASS karaoke). */
  secondaryColor?: string;
  /** Bold text. */
  bold?: boolean;
  /** Italic text. */
  italic?: boolean;
  /** Underline text. */
  underline?: boolean;
  /** Strike-out text. */
  strikeOut?: boolean;
  /**
   * Alignment (numpad layout):
   *   7 8 9  → top-left, top-center, top-right
   *   4 5 6  → mid-left, mid-center, mid-right
   *   1 2 3  → bot-left, bot-center, bot-right
   */
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Horizontal margin in pixels (left). */
  marginL?: number;
  /** Horizontal margin in pixels (right). */
  marginR?: number;
  /** Vertical margin in pixels. */
  marginV?: number;
}

export interface Cue {
  /** Optional cue identifier (SRT sequence number, VTT id, etc.). */
  id?: string;
  /** Start time in milliseconds from track start. */
  startMs: number;
  /** End time in milliseconds from track start. */
  endMs: number;
  /**
   * Cue text as plain Unicode. Line breaks are represented by a single \n.
   * Inline styling markup is stripped unless captured in `style`.
   */
  text: string;
  /** Optional styling metadata. Present only when the source format carries it. */
  style?: CueStyle;
}

export interface SubtitleTrack {
  /** Ordered list of cues. */
  cues: Cue[];
  /**
   * Format-specific key/value metadata.
   * e.g. ASS [Script Info] fields, VTT header regions.
   */
  metadata?: Record<string, string>;
}
