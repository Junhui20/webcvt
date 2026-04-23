import { parseSrt, serializeVtt } from '@catlabtech/webcvt-subtitle';

const MAX_BODY_BYTES = 1_048_576; // 1 MiB — subtitle files are small

const HELP = `webcvt — SRT → WebVTT on the edge

Usage:
  curl -X POST --data-binary @movie.srt \\
    -H 'content-type: text/plain' \\
    https://<your-worker>.workers.dev > movie.vtt

Limits: 1 MiB request body, text/plain or application/x-subrip content type.
Source: https://github.com/Junhui20/webcvt/tree/main/examples/cloudflare-worker
`;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      return new Response(HELP, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed. Use POST.', {
        status: 405,
        headers: { allow: 'GET, POST' },
      });
    }

    const lengthHeader = request.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > MAX_BODY_BYTES) {
      return new Response(`Payload too large (max ${MAX_BODY_BYTES} bytes)`, {
        status: 413,
      });
    }

    let srt: string;
    try {
      srt = await request.text();
    } catch (err) {
      return new Response(
        `Could not read body: ${err instanceof Error ? err.message : 'unknown error'}`,
        { status: 400 },
      );
    }

    if (srt.length === 0) {
      return new Response('Empty body. POST your .srt content.', { status: 400 });
    }

    if (srt.length > MAX_BODY_BYTES) {
      return new Response(`Body too large (max ${MAX_BODY_BYTES} bytes)`, { status: 413 });
    }

    try {
      const track = parseSrt(srt);
      const vtt = serializeVtt(track);
      return new Response(vtt, {
        status: 200,
        headers: {
          'content-type': 'text/vtt; charset=utf-8',
          'x-webcvt-cues': String(track.cues.length),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'parse error';
      return new Response(`SRT parse failed: ${message}`, { status: 422 });
    }
  },
} satisfies ExportedHandler;
