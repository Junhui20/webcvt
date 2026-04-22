import type { ConvertResult, FormatDescriptor } from '@catlabtech/webcvt-core';

/** Maximum allowed input file size (256 MiB). */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;

/** GitHub repository URL used throughout the UI. */
export const REPO_URL = 'https://github.com/Junhui20/webcvt';

export type ConversionPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'detecting' }
  | { readonly kind: 'ready'; readonly inputFormat: FormatDescriptor; readonly file: File }
  | { readonly kind: 'converting'; readonly percent: number; readonly phase?: string }
  | { readonly kind: 'done'; readonly result: ConvertResult; readonly objectUrl: string }
  | { readonly kind: 'error'; readonly message: string; readonly issueUrl?: string };

export interface AppState {
  readonly phase: ConversionPhase;
  readonly targetFormat: FormatDescriptor | null;
}

export class PlaygroundError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlaygroundError';
    this.code = code;
  }
}
