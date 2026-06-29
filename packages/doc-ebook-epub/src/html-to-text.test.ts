import { describe, expect, it } from 'vitest';
import { htmlToText } from './html-to-text.ts';

describe('htmlToText', () => {
  it('strips tags and inserts newlines for block elements', () => {
    const out = htmlToText('<h1>Title</h1><p>One</p><p>Two</p>');
    expect(out).toBe('Title\n\nOne\n\nTwo');
  });

  it('decodes the five predefined entities', () => {
    expect(htmlToText('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')).toBe(
      'a & b < c > d "e" \'f\'',
    );
  });

  it('decodes decimal and hex numeric character references', () => {
    expect(htmlToText('&#65;&#x42;&#x4a;')).toBe('ABJ');
  });

  it('drops <script> and <style> blocks entirely', () => {
    const out = htmlToText(
      '<p>keep</p><script>var x = 1 < 2;</script><style>.a{}</style><p>me</p>',
    );
    expect(out).toBe('keep\n\nme');
  });

  it('handles a <script> with no closing tag by dropping the remainder', () => {
    expect(htmlToText('<p>before</p><script>never ends')).toBe('before');
  });

  it('treats an unterminated tag as text', () => {
    expect(htmlToText('hello <world')).toBe('hello <world');
  });

  it('passes through a bare ampersand and an unknown entity', () => {
    expect(htmlToText('Tom & Jerry &unknown; &; &#;')).toBe('Tom & Jerry &unknown; &; &#;');
  });

  it('passes through an out-of-range numeric reference', () => {
    expect(htmlToText('&#xFFFFFFFF;')).toBe('&#xFFFFFFFF;');
  });

  it('ignores an ampersand whose semicolon is too far away', () => {
    expect(htmlToText('&thisisaverylongentity;')).toBe('&thisisaverylongentity;');
  });

  it('collapses runs of blank lines and trims', () => {
    expect(htmlToText('<div>a</div><div></div><div></div><div>b</div>')).toBe('a\n\nb');
  });

  it('returns text unchanged when it contains no entities or tags', () => {
    expect(htmlToText('just plain text')).toBe('just plain text');
  });

  it('handles closing tags without treating them as block tags', () => {
    expect(htmlToText('<span>x</span>y')).toBe('xy');
  });
});
