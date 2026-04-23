import { Converter } from './converter';

export default function HomePage() {
  return (
    <main>
      <h1>webcvt — SRT → WebVTT (Next.js)</h1>
      <p>
        This shell is server-rendered. The converter below is a{' '}
        <code>&apos;use client&apos;</code> component because file APIs and{' '}
        <code>URL.createObjectURL</code> only exist in the browser.
      </p>

      <pre>
        <code>{`'use client';
import { parseSrt, serializeVtt } from '@catlabtech/webcvt-subtitle';

const vtt = serializeVtt(parseSrt(srtText));`}</code>
      </pre>

      <Converter />

      <footer>
        <a href="https://github.com/Junhui20/webcvt">Source</a> ·{' '}
        <a href="https://webcvt.pages.dev">Playground</a> ·{' '}
        <a href="https://webcvt-docs.pages.dev">Docs</a>
      </footer>
    </main>
  );
}
