/**
 * OCF (Open Container Format) `container.xml` reader — EPUB 3.3 OCF §3.5.2.1.
 *
 * `META-INF/container.xml` lists one or more `<rootfile>` elements; the first
 * with `media-type="application/oebps-package+xml"` points (via `full-path`) at
 * the OPF package document. We rely on @catlabtech/webcvt-data-text's `parseXml`
 * for all XML security gating (DOCTYPE / ENTITY / XXE rejection).
 *
 * Clean-room from the W3C OCF specification.
 */

import { parseXml } from '@catlabtech/webcvt-data-text';
import { OPF_MEDIA_TYPE } from './constants.ts';
import { EpubInvalidContainerError } from './errors.ts';
import { allByLocalName, attrByLocalName } from './xml-util.ts';

/**
 * Parse `container.xml` bytes and return the declared OPF package full-path.
 *
 * @throws XML errors from `parseXml`, or {@link EpubInvalidContainerError} when
 *         no usable `<rootfile>` is present.
 */
export function parseContainerXml(bytes: Uint8Array): string {
  const file = parseXml(bytes);
  const rootfiles = allByLocalName(file.root, 'rootfile');

  if (rootfiles.length === 0) {
    throw new EpubInvalidContainerError('no <rootfile> element was found.');
  }

  for (const rootfile of rootfiles) {
    const mediaType = attrByLocalName(rootfile, 'media-type');
    if (mediaType === OPF_MEDIA_TYPE) {
      const fullPath = attrByLocalName(rootfile, 'full-path');
      if (fullPath !== undefined && fullPath.length > 0) {
        return fullPath;
      }
    }
  }

  throw new EpubInvalidContainerError(
    `no <rootfile> with media-type="${OPF_MEDIA_TYPE}" and a non-empty full-path was found.`,
  );
}
