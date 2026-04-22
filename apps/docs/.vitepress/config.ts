import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'webcvt',
  description: 'Browser-first, hardware-accelerated file conversion library',
  base: '/',
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Packages', link: '/packages/core' },
      { text: 'Reference', link: '/reference/error-codes' },
      { text: 'Playground', link: 'https://webcvt.pages.dev' },
      { text: 'GitHub', link: 'https://github.com/Junhui20/webcvt' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Browser Usage', link: '/guide/browser-usage' },
            { text: 'Node.js Usage', link: '/guide/nodejs-usage' },
            { text: 'CLI Usage', link: '/guide/cli-usage' },
          ],
        },
      ],
      '/packages/': [
        {
          text: 'Foundation',
          items: [
            { text: '@catlabtech/webcvt-core', link: '/packages/core' },
            { text: '@catlabtech/webcvt-codec-webcodecs', link: '/packages/codec-webcodecs' },
            { text: '@catlabtech/webcvt-backend-wasm', link: '/packages/backend-wasm' },
            { text: '@catlabtech/webcvt-ebml', link: '/packages/ebml' },
          ],
        },
        {
          text: 'Audio / Video Containers',
          items: [
            { text: '@catlabtech/webcvt-container-wav', link: '/packages/container-wav' },
            { text: '@catlabtech/webcvt-container-mp3', link: '/packages/container-mp3' },
            { text: '@catlabtech/webcvt-container-flac', link: '/packages/container-flac' },
            { text: '@catlabtech/webcvt-container-ogg', link: '/packages/container-ogg' },
            { text: '@catlabtech/webcvt-container-aac', link: '/packages/container-aac' },
            { text: '@catlabtech/webcvt-container-mp4', link: '/packages/container-mp4' },
            { text: '@catlabtech/webcvt-container-webm', link: '/packages/container-webm' },
            { text: '@catlabtech/webcvt-container-mkv', link: '/packages/container-mkv' },
            { text: '@catlabtech/webcvt-container-ts', link: '/packages/container-ts' },
          ],
        },
        {
          text: 'Images',
          items: [
            { text: '@catlabtech/webcvt-image-canvas', link: '/packages/image-canvas' },
            { text: '@catlabtech/webcvt-image-legacy', link: '/packages/image-legacy' },
            { text: '@catlabtech/webcvt-image-animation', link: '/packages/image-animation' },
            { text: '@catlabtech/webcvt-image-svg', link: '/packages/image-svg' },
          ],
        },
        {
          text: 'Archives, Data & Subtitles',
          items: [
            { text: '@catlabtech/webcvt-archive-zip', link: '/packages/archive-zip' },
            { text: '@catlabtech/webcvt-data-text', link: '/packages/data-text' },
            { text: '@catlabtech/webcvt-subtitle', link: '/packages/subtitle' },
          ],
        },
        {
          text: 'CLI',
          items: [{ text: '@catlabtech/webcvt-cli', link: '/packages/cli' }],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [{ text: 'Error Codes', link: '/reference/error-codes' }],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Junhui20/webcvt' }],
    footer: {
      message: 'MIT licensed',
      copyright: 'Copyright © 2026 webcvt contributors',
    },
    search: { provider: 'local' },
  },
});
