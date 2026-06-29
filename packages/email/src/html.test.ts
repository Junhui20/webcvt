import { describe, expect, it } from 'vitest';
import { stripHtml } from './html.ts';

describe('stripHtml', () => {
  it('strips inline tags and keeps text', () => {
    expect(stripHtml('<b>Bold</b> and <i>italic</i>')).toBe('Bold and italic');
  });

  it('turns block tags into line breaks', () => {
    const out = stripHtml('<p>One</p><p>Two</p>');
    expect(out).toContain('One');
    expect(out).toContain('Two');
    expect(out.indexOf('One')).toBeLessThan(out.indexOf('Two'));
  });

  it('converts <br> into a newline', () => {
    expect(stripHtml('line1<br>line2')).toBe('line1\nline2');
  });

  it('drops <script> and <style> blocks entirely', () => {
    expect(stripHtml('<script>alert(1)</script>Visible')).toBe('Visible');
    expect(stripHtml('<style>.x{color:red}</style>Shown')).toBe('Shown');
  });

  it('decodes named, decimal and hex entities', () => {
    expect(stripHtml('a &amp; b &lt;c&gt; &#65; &#x42;')).toBe('a & b <c> A B');
  });

  it('passes through an unknown entity or stray ampersand', () => {
    expect(stripHtml('Tom &unknownentity; Jerry &')).toContain('&unknownentity;');
  });

  it('treats an unterminated tag as text', () => {
    expect(stripHtml('text <b without close')).toContain('text');
  });

  it('drops an unterminated script block', () => {
    expect(stripHtml('keep<script>never closed')).toBe('keep');
  });
});
