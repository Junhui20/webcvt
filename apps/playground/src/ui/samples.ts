export type SampleHandler = (file: File) => void;

interface InlineSample {
  readonly name: string;
  readonly mime: string;
  readonly label: string;
  readonly b64: string;
}

// Samples are inlined as base64 so no network request is ever fired on user
// action (privacy invariant: DevTools Network tab stays clean).
const SAMPLES: readonly InlineSample[] = [
  {
    name: 'sample.png',
    mime: 'image/png',
    label: 'PNG image',
    b64: 'iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAAC0klEQVR4nO3SwYkDQRAEQTkg/11bc84HwSyTVwH9jy7Iz+d5fr7n+/35uP/cnRvMFRY37M4N5gqLG3bnBnOFxQ27c4O5wuKG3bnBXGFxw+7cYK6wuGF3bjBXWNywOzeYKyxu2J0bzBUWN+zODea+5Caf5t7uCosrLG7HFRZXWNyOKyyusLgdV1hcYXE7rrC4wuJ2XGFxhcXtuMLiCovbcYXFFRa34wqLKyxuxxUW90xYxae5AXduMFdY3LA7N5grLG7YnRvMFRY37M4N5gqLG3bnBnOFxQ27c4O5wuKG3bnBXGFxw+7cYK6wuGF3bjBXWNywOzeY+5KbfJp7uyssrrC4HVdYXGFxO66wuMLidlxhcYXF7bjC4gqL23GFxRUWt+MKiyssbscVFldY3I4rLK6wuB1XWNwzYRWf5gbcucFcYXHD7txgrrC4YXduMFdY3LA7N5grLG7YnRvMFRY37M4N5gqLG3bnBnOFxQ27c4O5wuKG3bnBXGFxw+7cYO5LbvJp7u2usLjC4nZcYXGFxe24wuIKi9txhcUVFrfjCosrLG7HFRZXWNyOKyyusLgdV1hcYXE7rrC4wuJ2XGFxz4RVfJobcOcGc4XFDbtzg7nC4obducFcYXHD7txgrrC4YXduMFdY3LA7N5grLG7YnRvMFRY37M4N5gqLG3bnBnOFxQ27c4O5L7nJp7m3u8LiCovbcYXFFRa34wqLKyxuxxUWV1jcjissrrC4HVdYXGFxO66wuMLidlxhcYXF7bjC4gqL23GFxT0TVvFpbsCdG8wVFjfszg3mCosbducGc4XFDbtzg7nC4obducFcYXHD7txgrrC4YXduMFdY3LA7N5grLG7YnRvMFRY37M4N5r7kJp/m3u4KiyssbscVFldY3I4rLK6wuB1XWFxhcTuusLjC4nZcYXGFxe24wuIKi9txhcUVFrfjCosrLG7HFRb3iPsHXVe8ROCEIeMAAAAASUVORK5CYII=',
  },
  {
    name: 'sample.srt',
    mime: 'text/plain',
    label: 'SRT subtitle',
    b64: 'MQowMDowMDowMCwwMDAgLS0+IDAwOjAwOjAyLDAwMApIZWxsbywgd2ViY3Z0IQoKMgowMDowMDowMiw1MDAgLS0+IDAwOjAwOjA1LDAwMApUaGlzIGlzIGEgc2FtcGxlIHN1YnRpdGxlIGZpbGUuCgozCjAwOjAwOjA1LDUwMCAtLT4gMDA6MDA6MDgsMDAwCkNvbnZlcnQgaXQgdG8gVlRUIG9yIEFTUyBmb3JtYXQgaW5zdGFudGx5LgoKNAowMDowMDowOCw1MDAgLS0+IDAwOjAwOjExLDAwMApBbGwgcHJvY2Vzc2luZyBoYXBwZW5zIGxvY2FsbHkgaW4geW91ciBicm93c2VyLgoKNQowMDowMDoxMSw1MDAgLS0+IDAwOjAwOjE0LDAwMApObyBmaWxlcyBhcmUgdXBsb2FkZWQgdG8gYW55IHNlcnZlci4K',
  },
];

function decodeBase64(b64: string, mime: string, name: string): File {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/** Render "Try a sample" buttons and wire click handlers. */
export function renderSamples(container: HTMLElement, onSample: SampleHandler): void {
  const section = container.querySelector<HTMLElement>('#samples-section');
  const list = container.querySelector<HTMLElement>('#samples-list');
  if (!section || !list) return;

  list.innerHTML = '';

  for (const sample of SAMPLES) {
    const btn = document.createElement('button');
    btn.className = 'sample-btn';
    btn.textContent = sample.label;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      onSample(decodeBase64(sample.b64, sample.mime, sample.name));
    });
    list.appendChild(btn);
  }

  section.hidden = false;
}
