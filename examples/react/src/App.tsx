import { parseSrt, serializeVtt } from '@catlabtech/webcvt-subtitle';
import { useCallback, useState } from 'react';

type Result =
  | { kind: 'idle' }
  | { kind: 'ready'; filename: string; vtt: string; cueCount: number }
  | { kind: 'error'; message: string };

export function App() {
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  const handleFile = useCallback(async (file: File) => {
    try {
      const srt = await file.text();
      const track = parseSrt(srt);
      const vtt = serializeVtt(track);
      setResult({
        kind: 'ready',
        filename: file.name.replace(/\.srt$/i, '.vtt'),
        vtt,
        cueCount: track.cues.length,
      });
    } catch (err) {
      setResult({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDownload = useCallback(() => {
    if (result.kind !== 'ready') return;
    const blob = new Blob([result.vtt], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <main>
      <h1>webcvt — SRT → WebVTT (React)</h1>
      <p>
        Drop a <code>.srt</code> file. Parsed and converted in the browser using{' '}
        <code>@catlabtech/webcvt-subtitle</code>.
      </p>

      <pre>
        <code>{`import { parseSrt, serializeVtt } from '@catlabtech/webcvt-subtitle';
const vtt = serializeVtt(parseSrt(srtText));`}</code>
      </pre>

      <input type="file" accept=".srt" onChange={onChange} />

      {result.kind === 'ready' && (
        <section className="output">
          <p>
            Parsed <strong>{result.cueCount}</strong> cues · <strong>{result.vtt.length}</strong>{' '}
            bytes
          </p>
          <button type="button" onClick={onDownload}>
            Download {result.filename}
          </button>
          <details>
            <summary>Preview output</summary>
            <pre>
              <code>
                {result.vtt.slice(0, 600)}
                {result.vtt.length > 600 ? '\n…' : ''}
              </code>
            </pre>
          </details>
        </section>
      )}

      {result.kind === 'error' && <p className="error">Error: {result.message}</p>}

      <footer>
        <a href="https://github.com/Junhui20/webcvt">Source</a> ·{' '}
        <a href="https://webcvt.pages.dev">Playground</a> ·{' '}
        <a href="https://webcvt-docs.pages.dev">Docs</a>
      </footer>
    </main>
  );
}
