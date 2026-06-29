import type { XmlElement } from '@catlabtech/webcvt-data-text';
import { describe, expect, it } from 'vitest';
import {
  allByLocalName,
  attrByLocalName,
  firstByLocalName,
  localName,
  trimmedText,
} from './xml-util.ts';

function el(
  name: string,
  attrs: Record<string, string> = {},
  children: XmlElement[] = [],
  text = '',
): XmlElement {
  return {
    name,
    attributes: Object.entries(attrs).map(([n, value]) => ({ name: n, value })),
    children,
    text,
  };
}

describe('localName', () => {
  it('strips the namespace prefix and lowercases', () => {
    expect(localName('dc:Title')).toBe('title');
    expect(localName('package')).toBe('package');
    expect(localName('a:b:c')).toBe('c');
  });
});

describe('attrByLocalName', () => {
  it('matches attributes case-insensitively by local name', () => {
    const node = el('item', { 'Media-Type': 'text/css', href: 'a.css' });
    expect(attrByLocalName(node, 'media-type')).toBe('text/css');
    expect(attrByLocalName(node, 'href')).toBe('a.css');
    expect(attrByLocalName(node, 'missing')).toBeUndefined();
  });
});

describe('trimmedText', () => {
  it('trims and returns undefined for empty/whitespace/undefined', () => {
    expect(trimmedText(el('x', {}, [], '  hi  '))).toBe('hi');
    expect(trimmedText(el('x', {}, [], '   '))).toBeUndefined();
    expect(trimmedText(undefined)).toBeUndefined();
  });
});

describe('firstByLocalName', () => {
  const tree = el('package', {}, [
    el('metadata', {}, [el('dc:title', {}, [], 'T'), el('dc:creator', {}, [], 'C')]),
  ]);

  it('finds a nested descendant', () => {
    expect(firstByLocalName(tree, 'title')?.text).toBe('T');
  });

  it('returns the root itself when it matches', () => {
    expect(firstByLocalName(tree, 'package')).toBe(tree);
  });

  it('returns undefined when absent', () => {
    expect(firstByLocalName(tree, 'spine')).toBeUndefined();
  });
});

describe('allByLocalName', () => {
  it('collects all matching descendants in document order, excluding the scope', () => {
    const manifest = el('manifest', {}, [
      el('item', { id: 'a' }),
      el('item', { id: 'b' }),
      el('item', { id: 'c' }),
    ]);
    const items = allByLocalName(manifest, 'item');
    expect(items.map((i) => attrByLocalName(i, 'id'))).toEqual(['a', 'b', 'c']);
    expect(allByLocalName(manifest, 'manifest')).toHaveLength(0);
  });
});
