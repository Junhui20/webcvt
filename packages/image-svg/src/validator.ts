/**
 * SVG security pre-filter (string-based reject pass).
 *
 * ALL checks in this module run BEFORE any DOMParser invocation.
 * This is defense in depth: we do not trust the XML parser to safely
 * handle entity declarations or external references.
 *
 * Checks performed (in order):
 *  1. `<!ENTITY`  — XXE attacks and billion-laughs (Trap §1, §2)
 *  2. `<!DOCTYPE` — any DTD is an entity-injection vector (Trap §1, §2)
 *  3. `<script`   — case-insensitive (Trap §4)
 *  4. `<foreignObject` — case-insensitive (Trap §5)
 *  5. External href regex — href/xlink:href not starting with `#` (Trap §3, §6)
 */

import {
  REJECT_DOCTYPE,
  REJECT_ENTITY,
  REJECT_EXTERNAL_HREF_RE,
  REJECT_FOREIGN_OBJECT_RE,
  REJECT_SCRIPT_RE,
} from './constants.ts';
import { SvgUnsafeContentError } from './errors.ts';

/**
 * Run the complete string-based security reject pass on a decoded SVG source.
 *
 * Throws `SvgUnsafeContentError` on first match.
 * Returns `void` when the source passes all checks.
 *
 * MUST be called before `new DOMParser().parseFromString(...)`.
 */
export function validateSvgSecurity(source: string): void {
  // Trap §1 + §2: entity declarations (XXE + billion-laughs).
  // Exact case — SVG/XML specs define `<!ENTITY` as case-sensitive.
  if (source.includes(REJECT_ENTITY)) {
    throw new SvgUnsafeContentError(REJECT_ENTITY);
  }

  // Trap §1: DOCTYPE (any DTD, even "harmless" ones provide injection vectors).
  // Exact case — `<!DOCTYPE` is case-sensitive in the XML spec.
  if (source.includes(REJECT_DOCTYPE)) {
    throw new SvgUnsafeContentError(REJECT_DOCTYPE);
  }

  // Trap §4: `<script` — case-insensitive.
  if (REJECT_SCRIPT_RE.test(source)) {
    throw new SvgUnsafeContentError('<script (case-insensitive)');
  }

  // Trap §5: `<foreignObject` — case-insensitive.
  if (REJECT_FOREIGN_OBJECT_RE.test(source)) {
    throw new SvgUnsafeContentError('<foreignObject (case-insensitive)');
  }

  // Trap §3 + §6: external href / xlink:href (any value not starting with `#`).
  if (REJECT_EXTERNAL_HREF_RE.test(source)) {
    throw new SvgUnsafeContentError('external href (not starting with #)');
  }
}
