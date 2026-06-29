/**
 * Small, depth-bounded helpers for walking the parsed OPF / container.xml tree.
 *
 * The tree is the `XmlElement` model returned by @catlabtech/webcvt-data-text's
 * `parseXml` (which has already enforced XXE / entity / depth security gates).
 * EPUB documents use XML namespaces (`dc:title`, `opf:item`, …); we match by the
 * lowercased local name so the same code works regardless of prefix or case.
 *
 * Every walk is bounded by MAX_XML_WALK_DEPTH so a pathological tree can never
 * cause unbounded recursion here.
 */

import type { XmlElement } from '@catlabtech/webcvt-data-text';
import { MAX_XML_WALK_DEPTH } from './constants.ts';

/** Return the lowercased local part of a (possibly namespaced) QName. */
export function localName(qname: string): string {
  const colon = qname.lastIndexOf(':');
  const local = colon >= 0 ? qname.slice(colon + 1) : qname;
  return local.toLowerCase();
}

/** Look up an attribute value by case-insensitive local name. */
export function attrByLocalName(el: XmlElement, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const attr of el.attributes) {
    if (localName(attr.name) === target) return attr.value;
  }
  return undefined;
}

/** The trimmed text content of an element, or undefined when empty/absent. */
export function trimmedText(el: XmlElement | undefined): string | undefined {
  if (el === undefined) return undefined;
  const text = el.text.trim();
  return text.length > 0 ? text : undefined;
}

function searchFirst(el: XmlElement, target: string, depth: number): XmlElement | undefined {
  if (localName(el.name) === target) return el;
  if (depth >= MAX_XML_WALK_DEPTH) return undefined;
  for (const child of el.children) {
    const found = searchFirst(child, target, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Depth-first search for the first element (including `root` itself) whose local
 * name matches `name`. Returns undefined when none is found.
 */
export function firstByLocalName(root: XmlElement, name: string): XmlElement | undefined {
  return searchFirst(root, name.toLowerCase(), 0);
}

function collectAll(el: XmlElement, target: string, out: XmlElement[], depth: number): void {
  if (localName(el.name) === target) out.push(el);
  if (depth >= MAX_XML_WALK_DEPTH) return;
  for (const child of el.children) {
    collectAll(child, target, out, depth + 1);
  }
}

/**
 * Collect every descendant of `scope` (excluding `scope` itself) whose local
 * name matches `name`, in document order.
 */
export function allByLocalName(scope: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const target = name.toLowerCase();
  for (const child of scope.children) {
    collectAll(child, target, out, 1);
  }
  return out;
}
