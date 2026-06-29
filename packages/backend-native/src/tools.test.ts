import { dirname, join } from 'node:path';
import type { ConvertOptions } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  ROUTE_TABLE,
  type ToolName,
  findRoute,
  inputExtForMime,
  listRoutes,
  routeKey,
} from './tools.ts';

const OPTS = { format: 'x' } as ConvertOptions;

function fd(ext: string) {
  return { ext };
}

describe('routeKey', () => {
  it('lowercases and joins with a pipe', () => {
    expect(routeKey('MD', 'HTML')).toBe('md|html');
  });
});

describe('findRoute', () => {
  it('resolves a pandoc markup pair (md → html)', () => {
    const route = findRoute(fd('md'), fd('html'));
    expect(route?.tool).toBe('pandoc');
  });

  it('resolves the two distinct pdf outputs separately (pdf vs pdfa)', () => {
    const redistill = findRoute(fd('pdf'), fd('pdf'));
    const pdfa = findRoute(fd('pdf'), fd('pdfa'));
    expect(redistill?.tool).toBe('ghostscript');
    expect(pdfa?.tool).toBe('ghostscript');
    // They must be different route objects with different args.
    const a = redistill?.buildArgs('/in.pdf', '/out.pdf', OPTS).join(' ');
    const b = pdfa?.buildArgs('/in.pdf', '/out.pdfa', OPTS).join(' ');
    expect(a).not.toBe(b);
    expect(b).toContain('-dPDFA=2');
  });

  it('returns undefined for an unknown pair', () => {
    expect(findRoute(fd('md'), fd('mp3'))).toBeUndefined();
    expect(findRoute(fd('zzz'), fd('qqq'))).toBeUndefined();
  });
});

describe('buildArgs — pandoc', () => {
  it('md → html includes -f markdown -t html and -o before in', () => {
    const route = findRoute(fd('md'), fd('html'));
    const args = route?.buildArgs('/tmp/in.md', '/tmp/out.html', OPTS);
    expect(args).toEqual(['-f', 'markdown', '-t', 'html', '-o', '/tmp/out.html', '/tmp/in.md']);
  });

  it('latex → pdf omits -t (writer inferred from output extension)', () => {
    const route = findRoute(fd('latex'), fd('pdf'));
    const args = route?.buildArgs('/tmp/in.tex', '/tmp/out.pdf', OPTS) ?? [];
    expect(args).toEqual(['-f', 'latex', '-o', '/tmp/out.pdf', '/tmp/in.tex']);
    expect(args).not.toContain('-t');
  });
});

describe('buildArgs — libreoffice', () => {
  it('docx → pdf uses --headless --convert-to --outdir', () => {
    const route = findRoute(fd('docx'), fd('pdf'));
    const args = route?.buildArgs('/tmp/d/in.docx', '/tmp/d/out.pdf', OPTS) ?? [];
    expect(args).toEqual([
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      '/tmp/d',
      '/tmp/d/in.docx',
    ]);
  });

  it('resolveProducedPath rebuilds <outdir>/<inbase>.<ext> (NOT the named outPath)', () => {
    const route = findRoute(fd('docx'), fd('pdf'));
    const inPath = '/tmp/d/webcvt-xyz-in.docx';
    const outPath = '/tmp/d/webcvt-xyz-out.pdf';
    const produced = route?.resolveProducedPath?.(inPath, outPath);
    expect(produced).toBe(join(dirname(outPath), 'webcvt-xyz-in.pdf'));
    expect(produced).not.toBe(outPath);
  });

  it('docx → odt targets the odt extension', () => {
    const route = findRoute(fd('docx'), fd('odt'));
    const args = route?.buildArgs('/t/in.docx', '/t/out.odt', OPTS) ?? [];
    expect(args).toContain('odt');
    expect(route?.resolveProducedPath?.('/t/in.docx', '/t/out.odt')).toBe('/t/in.odt');
  });
});

describe('buildArgs — ghostscript', () => {
  it('pdf → pdf re-distill targets pdfwrite and our outputFile', () => {
    const route = findRoute(fd('pdf'), fd('pdf'));
    const args = route?.buildArgs('/t/in.pdf', '/t/out.pdf', OPTS) ?? [];
    expect(args).toContain('-sDEVICE=pdfwrite');
    expect(args).toContain('-sOutputFile=/t/out.pdf');
    expect(args).toContain('-dSAFER');
  });
});

describe('buildArgs — ffmpeg', () => {
  it('avi → mp4 is -y -i in out', () => {
    const route = findRoute(fd('avi'), fd('mp4'));
    expect(route?.buildArgs('/t/in.avi', '/t/out.mp4', OPTS)).toEqual([
      '-y',
      '-i',
      '/t/in.avi',
      '/t/out.mp4',
    ]);
  });

  it('flv → mp4 routes to ffmpeg', () => {
    expect(findRoute(fd('flv'), fd('mp4'))?.tool).toBe('ffmpeg');
  });
});

describe('inputExtForMime', () => {
  it('maps known input MIMEs back to their extension', () => {
    expect(inputExtForMime('text/markdown')).toBe('md');
    expect(
      inputExtForMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
    expect(inputExtForMime('APPLICATION/PDF')).toBe('pdf');
  });

  it('falls back to the MIME subtype for unknown types', () => {
    expect(inputExtForMime('image/png')).toBe('png');
    expect(inputExtForMime('garbage')).toBe('');
  });
});

describe('listRoutes', () => {
  it('returns one entry per table row with its tool', () => {
    const rows = listRoutes();
    expect(rows.length).toBe(ROUTE_TABLE.length);
    const tools = new Set<ToolName>(rows.map((r) => r.tool));
    expect(tools).toEqual(new Set(['pandoc', 'libreoffice', 'ghostscript', 'ffmpeg']));
  });
});
