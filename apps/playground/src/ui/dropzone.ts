import { MAX_FILE_BYTES } from '../types.ts';

export type DropHandler = (files: File[]) => void;

export function createDropzone(container: HTMLElement, onDrop: DropHandler): () => void {
  const zone = container.querySelector<HTMLElement>('#dropzone');
  const fileInput = container.querySelector<HTMLInputElement>('#file-input');
  if (!zone || !fileInput) throw new Error('Dropzone elements not found');

  const handleFiles = (fileList: FileList | null | undefined): void => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const tooBig = files.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      zone.classList.add('error');
      const msg = zone.querySelector('#drop-message');
      if (msg) {
        msg.textContent = `Skipped ${tooBig.length} file(s) over 256 MiB. Use the CLI for large files.`;
      }
    }
    const ok = files.filter((f) => f.size <= MAX_FILE_BYTES);
    if (ok.length > 0) onDrop(ok);
  };

  const onDragover = (e: DragEvent): void => {
    e.preventDefault();
    zone.classList.add('drag-over');
  };

  const onDragleave = (): void => {
    zone.classList.remove('drag-over');
  };

  const onDropEvent = (e: DragEvent): void => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer?.files);
  };

  const onFileChange = (): void => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  };

  zone.addEventListener('dragover', onDragover);
  zone.addEventListener('dragleave', onDragleave);
  zone.addEventListener('drop', onDropEvent);
  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('keydown', onKeydown);
  fileInput.addEventListener('change', onFileChange);

  return (): void => {
    zone.removeEventListener('dragover', onDragover);
    zone.removeEventListener('dragleave', onDragleave);
    zone.removeEventListener('drop', onDropEvent);
    fileInput.removeEventListener('change', onFileChange);
  };
}

export function resetDropzone(container: HTMLElement): void {
  const zone = container.querySelector<HTMLElement>('#dropzone');
  const msg = container.querySelector<HTMLElement>('#drop-message');
  if (zone) zone.classList.remove('error', 'drag-over');
  if (msg) msg.textContent = 'Drop a file here or click to browse';
}
