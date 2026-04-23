# webcvt — Next.js example

A minimal Next.js (App Router) app that converts `.srt` subtitles to WebVTT in the browser, using [`@catlabtech/webcvt-subtitle`](https://www.npmjs.com/package/@catlabtech/webcvt-subtitle).

## The SSR-safe pattern

`parseSrt` + `serializeVtt` are pure functions with no DOM dependency, so they are *technically* safe to call from a Server Component. But the file-upload UI uses `<input type="file">`, `URL.createObjectURL`, and `useState` — all browser-only — so the converter is split into a `'use client'` component:

```
app/
├── layout.tsx       # server component (just the HTML shell)
├── page.tsx         # server component (renders <Converter />)
├── converter.tsx    # 'use client' — owns the file API + state
└── globals.css
```

This is the standard App Router pattern: keep server components small and stateless; push interactivity to leaf client components.

## Run locally

From the monorepo root:

```bash
pnpm install
pnpm --filter @catlabtech/webcvt-example-nextjs dev
```

Then open `http://localhost:3000`.

## Build

```bash
pnpm --filter @catlabtech/webcvt-example-nextjs build
```

Standard `.next/` output. Ship to Vercel, CF Pages with the Next-on-Pages adapter, or any Node host.

## Why a separate `converter.tsx`?

If you put `'use client'` at the top of `page.tsx` instead, the *whole page* opts out of SSR. That's fine for a demo, but in real apps you usually want to:

- SSR the layout, copy, SEO meta, and any data-fetched parts
- Hydrate only the interactive widget

Splitting the converter into its own client component keeps the rest of the page server-rendered — the same shape you'd want in production code.

## What this proves

- `@catlabtech/webcvt-subtitle` works inside a Next.js client bundle without `transpilePackages` or other workarounds (it ships ESM + CJS + types correctly)
- The text-subtitle path is SSR-friendly when called from the right boundary
- No special `next.config.js` shimming is needed

For binary formats (MP4 → WebM, etc.) you'd add `@catlabtech/webcvt-codec-webcodecs` or `@catlabtech/webcvt-backend-wasm` and dynamic-import them inside a `useEffect` — keep them out of the SSR pass.
