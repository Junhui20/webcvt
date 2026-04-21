# Error Codes

All webcvt errors extend `WebcvtError` (from `@webcvt/core`) and carry a `.code` string property for programmatic matching.

```ts
import { WebcvtError } from '@webcvt/core';

try {
  await convert(input, { format: 'mp4' });
} catch (err) {
  if (err instanceof WebcvtError) {
    console.error(err.code, err.message);
  }
}
```

---

## @webcvt/core

| Class | Code | When thrown |
|---|---|---|
| `UnsupportedFormatError` | `UNSUPPORTED_FORMAT` | Input or output format is not recognized by any registered backend |
| `NoBackendError` | `NO_BACKEND` | No registered backend can handle the input→output pair |

---

## @webcvt/backend-wasm

| Class | Code | When thrown |
|---|---|---|
| `WasmLoadError` | `WASM_LOAD_FAILED` | The ffmpeg WASM binary failed to load or initialize |
| `WasmExecutionError` | `WASM_EXEC_FAILED` | ffmpeg exited with a non-zero exit code |
| `WasmUnsupportedError` | `WASM_UNSUPPORTED` | The requested format pair is not on the backend's allowlist |

---

## @webcvt/codec-webcodecs

| Class | Code | When thrown |
|---|---|---|
| `WebCodecsNotSupportedError` | `WEBCODECS_NOT_SUPPORTED` | The WebCodecs API is not available in the current environment |
| `UnsupportedCodecError` | `UNSUPPORTED_CODEC` | The requested codec is not supported by the browser's WebCodecs implementation |
| `CodecOperationError` | `CODEC_OPERATION_ERROR` | A codec encode or decode operation failed |

---

## @webcvt/ebml

| Class | Code | When thrown |
|---|---|---|
| `EbmlVintError` | `EBML_VINT_ERROR` | Invalid EBML variable-length integer encoding |
| `EbmlElementTooLargeError` | `EBML_ELEMENT_TOO_LARGE` | An EBML element's declared size exceeds the allowed limit |
| `EbmlTooManyElementsError` | `EBML_TOO_MANY_ELEMENTS` | Element count exceeds the parser's safety cap |
| `EbmlDepthExceededError` | `EBML_DEPTH_EXCEEDED` | EBML nesting depth exceeds the maximum |
| `EbmlTruncatedError` | `EBML_TRUNCATED` | Input ended before all declared data was read |
| `EbmlUnknownSizeError` | `EBML_UNKNOWN_SIZE` | An element uses unknown-size encoding where it is not permitted |

---

## @webcvt/container-wav

| Class | Code | When thrown |
|---|---|---|
| `WavTooLargeError` | `WAV_TOO_LARGE` | Input exceeds the maximum supported WAV file size |
| `WavFormatError` | `WAV_FORMAT_ERROR` | RIFF/WAVE structure is malformed or missing required chunks |
| `UnsupportedSubFormatError` | `WAV_UNSUPPORTED_SUBFORMAT` | WAVE_FORMAT_EXTENSIBLE sub-format GUID is not supported |

---

## @webcvt/container-mp3

| Class | Code | When thrown |
|---|---|---|
| `Mp3FreeFormatError` | `MP3_FREE_FORMAT` | Free-format bitrate MP3 streams are not supported |
| `Mp3Mpeg25EncodeNotSupportedError` | `MP3_MPEG25_ENCODE_NOT_SUPPORTED` | MPEG 2.5 encoding is not implemented |
| `Mp3InvalidFrameError` | `MP3_INVALID_FRAME` | An MP3 frame header is corrupt or invalid |
| `Mp3UnsynchronisationError` | `MP3_UNSYNCHRONISATION_ERROR` | ID3v2 unsynchronisation scheme produced invalid data |
| `Mp3EncodeNotImplementedError` | `MP3_ENCODE_NOT_IMPLEMENTED` | MP3 encoding is not yet implemented in pure TypeScript |

---

## @webcvt/container-flac

| Class | Code | When thrown |
|---|---|---|
| `FlacInputTooLargeError` | `FLAC_INPUT_TOO_LARGE` | Input exceeds the maximum supported FLAC file size |
| `FlacInvalidMagicError` | `FLAC_INVALID_MAGIC` | File does not begin with the `fLaC` stream marker |
| `FlacInvalidMetadataError` | `FLAC_INVALID_METADATA` | A FLAC metadata block is malformed |
| `FlacCrc8MismatchError` | `FLAC_CRC8_MISMATCH` | Frame header CRC-8 check failed |
| `FlacCrc16MismatchError` | `FLAC_CRC16_MISMATCH` | Frame footer CRC-16 check failed |
| `FlacInvalidVarintError` | `FLAC_INVALID_VARINT` | A UTF-8 coded integer in a FLAC frame is malformed |
| `FlacInvalidFrameError` | `FLAC_INVALID_FRAME` | A FLAC audio frame is corrupt or invalid |
| `FlacEncodeNotImplementedError` | `FLAC_ENCODE_NOT_IMPLEMENTED` | FLAC encoding is not yet implemented in pure TypeScript |

---

## @webcvt/container-ogg

| Class | Code | When thrown |
|---|---|---|
| `OggInputTooLargeError` | `OGG_INPUT_TOO_LARGE` | Input exceeds the maximum supported Ogg file size |
| `OggCaptureMissingError` | `OGG_CAPTURE_MISSING` | No Ogg capture pattern (`OggS`) found at the expected position |
| `OggInvalidVersionError` | `OGG_INVALID_VERSION` | Ogg page header version field is not 0 |
| `OggSequenceGapError` | `OGG_SEQUENCE_GAP` | Page sequence numbers are non-contiguous |
| `OggCorruptStreamError` | `OGG_CORRUPT_STREAM` | Ogg stream data is corrupt |
| `OggMultiplexNotSupportedError` | `OGG_MULTIPLEX_NOT_SUPPORTED` | Multiplexed (multi-stream) Ogg files are not supported |
| `OggPacketTooLargeError` | `OGG_PACKET_TOO_LARGE` | A single Ogg packet exceeds the size limit |
| `OggTooManyPacketsError` | `OGG_TOO_MANY_PACKETS` | Packet count exceeds the safety cap |
| `OggTooManyPagesError` | `OGG_TOO_MANY_PAGES` | Page count exceeds the safety cap |
| `OggUnsupportedCodecError` | `OGG_UNSUPPORTED_CODEC` | The codec carried in the Ogg stream is not supported |

---

## @webcvt/container-aac

| Class | Code | When thrown |
|---|---|---|
| `AdtsInputTooLargeError` | `ADTS_INPUT_TOO_LARGE` | Input exceeds the maximum supported ADTS file size |
| `AdtsTruncatedFrameError` | `ADTS_TRUNCATED_FRAME` | An ADTS frame is truncated before its declared end |
| `AdtsCorruptStreamError` | `ADTS_CORRUPT_STREAM` | ADTS sync word not found or stream is corrupt |
| `AdtsPceRequiredError` | `ADTS_PCE_REQUIRED` | Program Config Element required but absent |
| `AdtsReservedSampleRateError` | `ADTS_RESERVED_SAMPLE_RATE` | ADTS header uses a reserved (undefined) sample rate index |
| `AdtsInvalidLayerError` | `ADTS_INVALID_LAYER` | ADTS header layer field is not 0 as required by the spec |
| `AdtsMultipleRawBlocksUnsupportedError` | `ADTS_MULTIPLE_RAW_BLOCKS_UNSUPPORTED` | Multiple raw data blocks per ADTS frame are not supported |
| `AdtsInvalidProfileError` | `ADTS_INVALID_PROFILE` | ADTS header profile index is out of range |
| `AdtsCrcUnsupportedError` | `ADTS_CRC_UNSUPPORTED` | ADTS CRC protection mode is not supported |
| `AdtsEncodeNotImplementedError` | `ADTS_ENCODE_NOT_IMPLEMENTED` | AAC/ADTS encoding is not yet implemented in pure TypeScript |

---

## @webcvt/container-mp4

| Class | Code | When thrown |
|---|---|---|
| `Mp4InputTooLargeError` | `MP4_INPUT_TOO_LARGE` | Input exceeds the maximum supported MP4 file size |
| `Mp4MissingFtypError` | `MP4_MISSING_FTYP` | No `ftyp` box found as the first box |
| `Mp4UnsupportedBrandError` | `MP4_UNSUPPORTED_BRAND` | The `ftyp` major brand is not supported |
| `Mp4MissingMoovError` | `MP4_MISSING_MOOV` | No `moov` box found |
| `Mp4MultiTrackNotSupportedError` | `MP4_MULTI_TRACK_NOT_SUPPORTED` | Multi-track MP4 files are not supported in this operation |
| `Mp4NoTracksError` | `MP4_NO_TRACKS` | The `moov` box contains no `trak` children |
| `Mp4TooManyTracksError` | `MP4_TOO_MANY_TRACKS` | Track count exceeds the safety cap |
| `Mp4TrackIdZeroError` | `MP4_TRACK_ID_ZERO` | A track ID of 0 is not permitted by the MP4 spec |
| `Mp4DuplicateTrackIdError` | `MP4_DUPLICATE_TRACK_ID` | Two tracks share the same track ID |
| `Mp4AmbiguousTrackError` | `MP4_AMBIGUOUS_TRACK` | Could not determine which track to use for conversion |

---

## @webcvt/container-webm

| Class | Code | When thrown |
|---|---|---|
| `WebmInputTooLargeError` | `WEBM_INPUT_TOO_LARGE` | Input exceeds the maximum supported WebM file size |
| `WebmDocTypeNotSupportedError` | `WEBM_DOCTYPE_NOT_SUPPORTED` | EBML DocType is not `webm` |
| `WebmEbmlVersionError` | `WEBM_EBML_VERSION_ERROR` | EBML version field value is not supported |
| `WebmEbmlLimitError` | `WEBM_EBML_LIMIT_ERROR` | An EBML limit field exceeds the supported maximum |
| `WebmMissingElementError` | `WEBM_MISSING_ELEMENT` | A required WebM element is absent |
| `WebmUnsupportedCodecError` | `WEBM_UNSUPPORTED_CODEC` | The codec ID in the WebM track is not supported |
| `WebmLacingNotSupportedError` | `WEBM_LACING_NOT_SUPPORTED` | Laced SimpleBlocks (fixed-size or EBML lacing) are not supported |
| `WebmMultiTrackNotSupportedError` | `WEBM_MULTI_TRACK_NOT_SUPPORTED` | Multi-track WebM files are not supported in this operation |
| `WebmUnsupportedTrackTypeError` | `WEBM_UNSUPPORTED_TRACK_TYPE` | The WebM track type is not video or audio |
| `WebmMissingTimecodeError` | _(see source)_ | A required timecode element is missing |
| `WebmMissingSegmentError` | `WEBM_MISSING_SEGMENT` | No Segment element found in the WebM file |
| `WebmEncodeNotImplementedError` | `WEBM_ENCODE_NOT_IMPLEMENTED` | WebM encoding is not yet implemented in pure TypeScript |

---

## @webcvt/container-mkv

| Class | Code | When thrown |
|---|---|---|
| `MkvInputTooLargeError` | `MKV_INPUT_TOO_LARGE` | Input exceeds the maximum supported MKV file size |
| `MkvDocTypeNotSupportedError` | `MKV_DOCTYPE_NOT_SUPPORTED` | EBML DocType is not `matroska` |
| `MkvEbmlVersionError` | `MKV_EBML_VERSION_ERROR` | EBML version field value is not supported |
| `MkvEbmlLimitError` | `MKV_EBML_LIMIT_ERROR` | An EBML limit field exceeds the supported maximum |
| `MkvMissingElementError` | `MKV_MISSING_ELEMENT` | A required MKV element is absent |
| `MkvUnsupportedCodecError` | `MKV_UNSUPPORTED_CODEC` | The codec ID in the MKV track is not supported |
| `MkvLacingNotSupportedError` | `MKV_LACING_NOT_SUPPORTED` | Laced SimpleBlocks (fixed-size or EBML lacing) are not supported |
| `MkvMultiTrackNotSupportedError` | `MKV_MULTI_TRACK_NOT_SUPPORTED` | Multi-track MKV files are not supported in this operation |
| `MkvUnsupportedTrackTypeError` | `MKV_UNSUPPORTED_TRACK_TYPE` | Track type is not video or audio |
| `MkvMissingTimecodeError` | _(see source)_ | A required timecode element is missing |
| `MkvTooManyBlocksError` | `MKV_TOO_MANY_BLOCKS` | Block count exceeds the safety cap |
| `MkvMissingSegmentError` | `MKV_MISSING_SEGMENT` | No Segment element found in the MKV file |
| `MkvTooManyCuePointsError` | `MKV_TOO_MANY_CUE_POINTS` | Cue point count exceeds the safety cap |
| `MkvEncryptionNotSupportedError` | `MKV_ENCRYPTION_NOT_SUPPORTED` | Encrypted MKV tracks are not supported |

---

## @webcvt/container-ts

| Class | Code | When thrown |
|---|---|---|
| `TsInputTooLargeError` | `TS_INPUT_TOO_LARGE` | Input exceeds the maximum supported TS file size |
| `TsNoSyncByteError` | `TS_NO_SYNC_BYTE` | No MPEG-2 TS sync byte (0x47) found at expected positions |
| `TsScrambledNotSupportedError` | `TS_SCRAMBLED_NOT_SUPPORTED` | Scrambled (encrypted) TS packets are not supported |
| `TsReservedAdaptationControlError` | `TS_RESERVED_ADAPTATION_CONTROL` | Adaptation field control value 0 is reserved and invalid |
| `TsMultiProgramNotSupportedError` | `TS_MULTI_PROGRAM_NOT_SUPPORTED` | Multi-program TS streams are not supported |
| `TsMissingPatError` | `TS_MISSING_PAT` | No PAT (Program Association Table) found |
| `TsMissingPmtError` | `TS_MISSING_PMT` | No PMT (Program Map Table) found |
| `TsCorruptStreamError` | `TS_CORRUPT_STREAM` | TS stream data is corrupt |
| `TsPsiCrcError` | `TS_PSI_CRC_ERROR` | CRC check failed on a PSI (PAT/PMT) table section |
| `TsTooManyPacketsError` | `TS_TOO_MANY_PACKETS` | Packet count exceeds the safety cap |
| `TsEncodeNotImplementedError` | `TS_ENCODE_NOT_IMPLEMENTED` | TS muxing is not yet implemented |
| `TsInvalidAdaptationLengthError` | `TS_INVALID_ADAPTATION_LENGTH` | Adaptation field length exceeds the remaining packet space |

---

## @webcvt/archive-zip

| Class | Code | When thrown |
|---|---|---|
| `ArchiveInputTooLargeError` | `ARCHIVE_INPUT_TOO_LARGE` | Archive input exceeds 200 MiB |
| `ArchiveInvalidEntryNameError` | `ARCHIVE_INVALID_ENTRY_NAME` | Entry name fails path-traversal validation |
| `ArchiveEntrySizeCapError` | `ARCHIVE_ENTRY_SIZE_CAP` | Entry's uncompressed size exceeds the 256 MiB per-entry cap |
| `ArchiveTotalSizeCapError` | `ARCHIVE_TOTAL_SIZE_CAP` | Cumulative uncompressed size exceeds the 512 MiB total cap |
| `ArchiveBz2NotSupportedError` | `ARCHIVE_BZ2_NOT_SUPPORTED` | BZ2 compressed entries are not supported |
| `ArchiveXzNotSupportedError` | `ARCHIVE_XZ_NOT_SUPPORTED` | XZ compressed entries are not supported |
| `ZipTooShortError` | `ZIP_TOO_SHORT` | Input is too short to be a valid ZIP file |
| `ZipNoEocdError` | `ZIP_NO_EOCD` | End-of-central-directory record not found |
| `ZipCommentTooLargeError` | `ZIP_COMMENT_TOO_LARGE` | ZIP file comment exceeds the maximum length |
| `ZipNotZip64SupportedError` | `ZIP_NOT_ZIP64_SUPPORTED` | ZIP64 archives are not supported |
| `ZipMultiDiskNotSupportedError` | `ZIP_MULTI_DISK_NOT_SUPPORTED` | Multi-disk (split) ZIP archives are not supported |
| `ZipBadLocalHeaderError` | `ZIP_BAD_LOCAL_HEADER` | A local file header signature is invalid |
| `ZipUnsupportedMethodError` | `ZIP_UNSUPPORTED_METHOD` | A compression method other than Stored or Deflate was found |
| `ZipCompressionRatioError` | `ZIP_COMPRESSION_RATIO` | Decompressed/compressed ratio indicates a zip bomb |
| `ZipTooManyEntriesError` | `ZIP_TOO_MANY_ENTRIES` | Entry count exceeds the safety cap |
| `ZipCorruptStreamError` | `ZIP_CORRUPT_STREAM` | ZIP stream data is corrupt |
| `ZipTruncatedEntryError` | `ZIP_TRUNCATED_ENTRY` | Entry data is truncated |
| `TarMisalignedInputError` | `TAR_MISALIGNED_INPUT` | TAR input is not aligned to 512-byte blocks |
| `TarChecksumError` | `TAR_CHECKSUM` | TAR header checksum verification failed |
| `TarGnuVariantNotSupportedError` | `TAR_GNU_VARIANT_NOT_SUPPORTED` | GNU TAR extensions are not supported |
| `TarPaxNotSupportedError` | `TAR_PAX_NOT_SUPPORTED` | POSIX PAX extended headers are not supported |
| `TarTooManyEntriesError` | `TAR_TOO_MANY_ENTRIES` | TAR entry count exceeds the safety cap |
| `TarLongNameNotSupportedError` | `TAR_LONG_NAME_NOT_SUPPORTED` | Long name entries (@LongLink) are not supported |
| `TarCorruptStreamError` | `TAR_CORRUPT_STREAM` | TAR stream data is corrupt |
| `TarInvalidOctalFieldError` | `TAR_INVALID_OCTAL_FIELD` | A TAR header octal field contains non-octal characters |
| `TarCumulativeSizeCapError` | `TAR_CUMULATIVE_SIZE_CAP` | Cumulative extracted size exceeds the safety cap |
| `GzipInvalidMagicError` | `GZIP_INVALID_MAGIC` | Input does not begin with the GZip magic bytes |
| `GzipUnsupportedMethodError` | `GZIP_UNSUPPORTED_METHOD` | GZip compression method is not DEFLATE |
| `ArchiveEncodeNotImplementedError` | `ARCHIVE_ENCODE_NOT_IMPLEMENTED` | Archive creation is not yet implemented |

---

## @webcvt/data-text

| Class | Code | When thrown |
|---|---|---|
| `InputTooLargeError` | `DATA_TEXT_INPUT_TOO_LARGE` | Input size exceeds the byte cap |
| `InputTooManyCharsError` | `DATA_TEXT_INPUT_TOO_MANY_CHARS` | Input character count exceeds the cap |
| `JsonInvalidUtf8Error` | `JSON_INVALID_UTF8` | JSON input contains malformed UTF-8 |
| `JsonDepthExceededError` | `JSON_DEPTH_EXCEEDED` | JSON nesting depth exceeds the safety cap |
| `JsonParseError` | `JSON_PARSE_ERROR` | JSON parsing failed |
| `CsvInvalidUtf8Error` | `CSV_INVALID_UTF8` | CSV/TSV input contains malformed UTF-8 |
| `CsvUnterminatedQuoteError` | `CSV_UNTERMINATED_QUOTE` | A quoted CSV field was never closed |
| `CsvUnexpectedQuoteError` | `CSV_UNEXPECTED_QUOTE` | A quote character appeared in an unquoted field |
| `CsvBadQuoteError` | `CSV_BAD_QUOTE` | Invalid character after a closing quote |
| `CsvRowCapError` | `CSV_ROW_CAP_EXCEEDED` | Row count exceeds the safety cap |
| `CsvColCapError` | `CSV_COL_CAP_EXCEEDED` | Column count per row exceeds the safety cap |
| `CsvCellCapError` | `CSV_CELL_CAP_EXCEEDED` | Total cell count exceeds the safety cap |
| `CsvDuplicateHeaderError` | `CSV_DUPLICATE_HEADER` | Header row contains duplicate column names |
| `CsvRaggedRowError` | _(see source)_ | A CSV row has a different column count than the header |
| `UnsupportedFormatError` | `UNSUPPORTED_FORMAT` | MIME type is not recognized by data-text |
| `IniInvalidUtf8Error` | `INI_INVALID_UTF8` | INI input contains malformed UTF-8 |
| `IniEmptyKeyError` | `INI_EMPTY_KEY` | An INI key is empty |
| `IniSyntaxError` | `INI_SYNTAX_ERROR` | INI input has invalid syntax |
| `EnvSyntaxError` | `ENV_SYNTAX_ERROR` | ENV input has invalid syntax |
| `EnvBadEscapeError` | `ENV_BAD_ESCAPE` | Invalid escape sequence in ENV value |
| `JsonlRecordParseError` | _(see source)_ | A JSONL record failed to parse as JSON |
| `JsonlRecordDepthExceededError` | _(see source)_ | A JSONL record's nesting depth exceeds the cap |
| `JsonlRecordTooLongError` | _(see source)_ | A single JSONL line exceeds the length cap |
| `TomlParseError` | `TOML_PARSE_ERROR` | TOML parsing failed |
| `TomlDuplicateKeyError` | `TOML_DUPLICATE_KEY` | TOML input contains a duplicate key |
| `TomlRedefineTableError` | `TOML_REDEFINE_TABLE` | TOML table is defined more than once |
| `TomlBadEscapeError` | `TOML_BAD_ESCAPE` | Invalid escape sequence in TOML string |
| `TomlBadNumberError` | `TOML_BAD_NUMBER` | Invalid number literal in TOML |
| `TomlBadDateError` | `TOML_BAD_DATE` | Invalid date/time literal in TOML |
| `TomlDepthExceededError` | `TOML_DEPTH_EXCEEDED` | TOML nesting depth exceeds the safety cap |
| `TomlStringTooLongError` | `TOML_STRING_TOO_LONG` | A TOML string value exceeds the length cap |
| `TomlSerializeError` | `TOML_SERIALIZE_ERROR` | TOML serialization failed |
| `XmlInvalidUtf8Error` | `XML_INVALID_UTF8` | XML input contains malformed UTF-8 |
| `XmlDoctypeForbiddenError` | `XML_DOCTYPE_FORBIDDEN` | XML DOCTYPE declarations are rejected for security |
| `XmlEntityForbiddenError` | `XML_ENTITY_FORBIDDEN` | XML entity declarations are rejected for security |
| `XmlForbiddenPiError` | `XML_FORBIDDEN_PI` | A forbidden processing instruction was found |
| `XmlParseError` | `XML_PARSE_ERROR` | XML parsing failed |
| `XmlDepthExceededError` | `XML_DEPTH_EXCEEDED` | XML nesting depth exceeds the safety cap |
| `XmlTooManyAttrsError` | `XML_TOO_MANY_ATTRS` | Element attribute count exceeds the safety cap |
| `XmlBadElementNameError` | `XML_BAD_ELEMENT_NAME` | Element name contains invalid characters |
| `XmlSerializeError` | `XML_SERIALIZE_ERROR` | XML serialization failed |
| `FwfInvalidUtf8Error` | `FWF_INVALID_UTF8` | Fixed-width format input contains malformed UTF-8 |
| `FwfOverlappingColumnsError` | `FWF_OVERLAPPING_COLUMNS` | FWF column definitions overlap |
| `FwfInvalidColumnError` | `FWF_INVALID_COLUMN` | FWF column definition is invalid |
| `FwfTooManyColumnsError` | `FWF_TOO_MANY_COLUMNS` | FWF column count exceeds the safety cap |
| `FwfFieldOverflowError` | `FWF_FIELD_OVERFLOW` | A FWF field value exceeds its declared width |
| `YamlInvalidUtf8Error` | `YAML_INVALID_UTF8` | YAML input contains malformed UTF-8 |
| `YamlIndentError` | `YAML_INDENT_ERROR` | YAML indentation is inconsistent |
| `YamlDirectiveForbiddenError` | `YAML_DIRECTIVE_FORBIDDEN` | YAML directives are not permitted |
| `YamlMergeKeyForbiddenError` | `YAML_MERGE_KEY_FORBIDDEN` | YAML merge key (`<<`) is not supported |
| `YamlAnchorUndefinedError` | `YAML_ANCHOR_UNDEFINED` | YAML alias references an undefined anchor |
| `YamlAliasLimitError` | `YAML_ALIAS_LIMIT` | Alias count exceeds the safety cap (prevents alias bombs) |
| `YamlScalarTooLongError` | `YAML_SCALAR_TOO_LONG` | A YAML scalar value exceeds the length cap |
| `YamlMapTooLargeError` | `YAML_MAP_TOO_LARGE` | YAML mapping key count exceeds the safety cap |
| `YamlSeqTooLargeError` | `YAML_SEQ_TOO_LARGE` | YAML sequence length exceeds the safety cap |
| `YamlComplexKeyForbiddenError` | `YAML_COMPLEX_KEY_FORBIDDEN` | Complex (non-scalar) YAML keys are not supported |
| `YamlDuplicateKeyError` | `YAML_DUPLICATE_KEY` | YAML mapping contains a duplicate key |

---

## @webcvt/image-animation

| Class | Code | When thrown |
|---|---|---|
| `ImageInputTooLargeError` | `IMAGE_INPUT_TOO_LARGE` | Image input exceeds the size cap |
| `AnimationUnsupportedFormatError` | `ANIMATION_UNSUPPORTED_FORMAT` | MIME type is not supported by image-animation |
| `GifTooShortError` | `GIF_TOO_SHORT` | Input is too short to be a valid GIF |
| `GifBadSignatureError` | `GIF_BAD_SIGNATURE` | GIF signature is not `GIF87a` or `GIF89a` |
| `GifBadDimensionError` | `GIF_BAD_DIMENSION` | GIF canvas dimension is out of the valid range |
| `GifNoPaletteError` | `GIF_NO_PALETTE` | GIF frame has no local palette and there is no global palette |
| `GifFrameOutOfBoundsError` | `GIF_FRAME_OUT_OF_BOUNDS` | A GIF frame's position/size extends beyond the canvas |
| `GifUnknownExtensionError` | `GIF_UNKNOWN_EXTENSION` | An unknown GIF extension block was encountered |
| `GifBadBlockIntroError` | `GIF_BAD_BLOCK_INTRO` | GIF block introducer byte is invalid |
| `GifLzwInvalidCodeError` | `GIF_LZW_INVALID_CODE` | GIF LZW stream contains an invalid code |
| `GifLzwTruncatedError` | `GIF_LZW_TRUNCATED` | GIF LZW stream ended unexpectedly |
| `GifTooManyFramesError` | `GIF_TOO_MANY_FRAMES` | GIF frame count exceeds the safety cap |
| `GifFrameTooLargeError` | `GIF_FRAME_TOO_LARGE` | A GIF frame's pixel count exceeds the safety cap |
| `GifBadLzwMinCodeSizeError` | `GIF_BAD_LZW_MIN_CODE_SIZE` | GIF LZW minimum code size is out of the valid range |
| `ApngTooShortError` | `APNG_TOO_SHORT` | Input is too short to be a valid APNG |
| `ApngBadSignatureError` | `APNG_BAD_SIGNATURE` | PNG signature bytes are invalid |
| `ApngBadCrcError` | `APNG_BAD_CRC` | A PNG chunk CRC check failed |
| `ApngBadSequenceError` | `APNG_BAD_SEQUENCE` | APNG frame sequence numbers are non-contiguous |
| `ApngUnknownCriticalChunkError` | `APNG_UNKNOWN_CRITICAL_CHUNK` | An unknown critical PNG chunk was encountered |
| `ApngHiddenDefaultNotSupportedError` | `APNG_HIDDEN_DEFAULT_NOT_SUPPORTED` | APNG files where the default image is hidden are not supported |
| `ApngZeroFramesError` | `APNG_ZERO_FRAMES` | APNG animation has zero frames |
| `ApngTooManyFramesError` | `APNG_TOO_MANY_FRAMES` | APNG frame count exceeds the safety cap |
| `ApngBadDimensionError` | `APNG_BAD_DIMENSION` | APNG frame dimension is invalid |
| `ApngFrameOutOfBoundsError` | `APNG_FRAME_OUT_OF_BOUNDS` | An APNG frame extends beyond the canvas |
| `ApngChunkStreamTruncatedError` | `APNG_CHUNK_STREAM_TRUNCATED` | APNG chunk data ended unexpectedly |
| `WebpAnimTooShortError` | `WEBP_ANIM_TOO_SHORT` | Input is too short to be a valid animated WebP |
| `WebpBadRiffError` | `WEBP_BAD_RIFF` | WebP RIFF header is invalid |
| `WebpAnimMissingVp8xError` | _(see source)_ | VP8X chunk required for animation is missing |
| `WebpStaticNotSupportedError` | `WEBP_STATIC_NOT_SUPPORTED` | Static WebP input is handled by image-canvas, not image-animation |
| `WebpAnimUnknownChunkError` | `WEBP_ANIM_UNKNOWN_CHUNK` | An unknown WebP chunk was encountered |
| `WebpBadDimensionError` | `WEBP_BAD_DIMENSION` | WebP canvas dimension is invalid |
| `WebpFrameOutOfBoundsError` | `WEBP_FRAME_OUT_OF_BOUNDS` | A WebP frame extends beyond the canvas |
| `WebpAnimOddOffsetError` | `WEBP_ANIM_ODD_OFFSET` | WebP frame offset must be even per the spec |
| `WebpChunkStreamTruncatedError` | `WEBP_CHUNK_STREAM_TRUNCATED` | WebP chunk data ended unexpectedly |

---

## @webcvt/image-legacy

| Class | Code | When thrown |
|---|---|---|
| `ImageInputTooLargeError` | `IMAGE_INPUT_TOO_LARGE` | Input exceeds the size cap |
| `ImagePixelCapError` | `IMAGE_PIXEL_CAP_EXCEEDED` | Decoded pixel count exceeds the safety cap |
| `PbmBadMagicError` | `PBM_BAD_MAGIC` | PBM magic is not P1 or P4 |
| `PbmBadAsciiByteError` | `PBM_BAD_ASCII_BYTE` | Invalid byte in PBM ASCII raster |
| `PbmSizeMismatchError` | `PBM_SIZE_MISMATCH` | PBM raster pixel count does not match header |
| `PgmBadMagicError` | `PGM_BAD_MAGIC` | PGM magic is not P2 or P5 |
| `PgmBadMaxvalError` | `PGM_BAD_MAXVAL` | PGM maxval is out of the valid range |
| `PgmSampleOutOfRangeError` | `PGM_SAMPLE_OUT_OF_RANGE` | A PGM sample value exceeds maxval |
| `PpmBadMagicError` | `PPM_BAD_MAGIC` | PPM magic is not P3 or P6 |
| `PpmSampleOutOfRangeError` | `PPM_SAMPLE_OUT_OF_RANGE` | A PPM sample value exceeds maxval |
| `PfmBadMagicError` | `PFM_BAD_MAGIC` | PFM magic is not PF or Pf |
| `PfmBadScaleError` | `PFM_BAD_SCALE` | PFM scale factor is zero or invalid |
| `QoiBadMagicError` | `QOI_BAD_MAGIC` | QOI magic bytes are invalid |
| `QoiBadHeaderError` | `QOI_BAD_HEADER` | QOI header fields are out of range |
| `QoiSizeMismatchError` | `QOI_SIZE_MISMATCH` | QOI decoded pixel count does not match header |
| `XbmBadHeaderError` | `XBM_BAD_HEADER` | XBM C-header is malformed |
| `XbmMissingDefineError` | `XBM_MISSING_DEFINE` | Required `#define` directive is missing from XBM |
| `XbmPrefixMismatchError` | `XBM_PREFIX_MISMATCH` | XBM dimension defines use inconsistent prefixes |
| `XbmSizeMismatchError` | `XBM_SIZE_MISMATCH` | XBM data length does not match declared dimensions |
| `XbmBadIdentifierError` | `XBM_BAD_IDENTIFIER` | XBM identifier contains invalid characters |
| `PcxBadMagicError` | `PCX_BAD_MAGIC` | PCX magic byte is not 0x0A |
| `PcxBadVersionError` | `PCX_BAD_VERSION` | PCX version field is not a recognized value |
| `PcxBadHeaderError` | `PCX_BAD_HEADER` | PCX header fields are inconsistent or invalid |
| `PcxUnsupportedFeatureError` | `PCX_UNSUPPORTED_FEATURE` | PCX file uses a feature not supported by the decoder |
| `PcxRleDecodeError` | `PCX_RLE_DECODE` | PCX RLE decoding produced an unexpected output size |
| `XpmBadHeaderError` | `XPM_BAD_HEADER` | XPM file does not begin with the expected header comment |
| `XpmBadValuesError` | `XPM_BAD_VALUES` | XPM values string is malformed |
| `XpmBadColorDefError` | `XPM_BAD_COLOR_DEF` | An XPM color definition entry is malformed |
| `XpmBadHexColorError` | `XPM_BAD_HEX_COLOR` | An XPM hex color value is invalid |
| `XpmUnknownColorError` | `XPM_UNKNOWN_COLOR` | An XPM pixel references an undefined color key |
| `XpmDuplicateKeyError` | `XPM_DUPLICATE_KEY` | An XPM color key is defined more than once |
| `XpmSizeMismatchError` | `XPM_SIZE_MISMATCH` | XPM pixel data length does not match declared dimensions |
| `XpmUnknownKeyError` | `XPM_UNKNOWN_KEY` | An XPM pixel uses a key not found in the color table |
| `XpmTooManyColorsError` | `XPM_TOO_MANY_COLORS` | XPM color count exceeds the safety cap |
| `ImageUnsupportedFormatError` | `IMAGE_UNSUPPORTED_FORMAT` | MIME type is not recognized by image-legacy |
| `TiffBadMagicError` | `TIFF_BAD_MAGIC` | TIFF byte-order mark is not `II` or `MM` |
| `TiffUnsupportedFeatureError` | `TIFF_UNSUPPORTED_FEATURE` | TIFF file uses a feature not supported by the decoder |
| `TiffBadIfdError` | `TIFF_BAD_IFD` | A TIFF IFD entry or offset is invalid |
| `TiffCircularIfdError` | `TIFF_CIRCULAR_IFD` | TIFF IFD chain forms a cycle |
| `TiffTooManyPagesError` | `TIFF_TOO_MANY_PAGES` | TIFF page (IFD) count exceeds the safety cap |
| `TiffBadTagValueError` | `TIFF_BAD_TAG_VALUE` | A TIFF tag value is out of range or invalid |
| `TiffPackBitsDecodeError` | `TIFF_PACKBITS_DECODE` | TIFF PackBits RLE decoding failed |
| `TiffLzwDecodeError` | `TIFF_LZW_DECODE` | TIFF LZW decoding failed |
| `TiffDeflateDecodeError` | `TIFF_DEFLATE_DECODE` | TIFF Deflate decompression failed |
| `IcnsBadMagicError` | `ICNS_BAD_MAGIC` | ICNS magic bytes are invalid |
| `IcnsBadHeaderSizeError` | `ICNS_BAD_HEADER_SIZE` | ICNS file header declares an invalid file size |
| `IcnsBadElementError` | `ICNS_BAD_ELEMENT` | An ICNS element is malformed |
| `IcnsTooManyElementsError` | `ICNS_TOO_MANY_ELEMENTS` | ICNS element count exceeds the safety cap |
| `IcnsUnsupportedFeatureError` | `ICNS_UNSUPPORTED_FEATURE` | ICNS file uses an unsupported feature |
| `IcnsPackBitsDecodeError` | `ICNS_PACKBITS_DECODE` | ICNS PackBits decompression failed |
| `IcnsMaskSizeMismatchError` | `ICNS_MASK_SIZE_MISMATCH` | ICNS mask size does not match icon dimensions |
| `TgaBadHeaderError` | `TGA_BAD_HEADER` | TGA header fields are invalid or unsupported |
| `TgaUnsupportedImageTypeError` | `TGA_UNSUPPORTED_IMAGE_TYPE` | TGA image type code is not recognized |

---

## @webcvt/image-svg

| Class | Code | When thrown |
|---|---|---|
| `SvgParseError` | `SVG_PARSE_ERROR` | SVG markup failed to parse |
| `SvgUnsafeContentError` | `SVG_UNSAFE_CONTENT` | SVG contains disallowed content (scripts, external refs) |
| `SvgInputTooLargeError` | `SVG_INPUT_TOO_LARGE` | SVG input exceeds the size cap |
| `SvgRasterizeTooLargeError` | `SVG_RASTERIZE_TOO_LARGE` | Requested raster dimensions exceed the safety cap |
| `SvgRasterizeError` | `SVG_RASTERIZE_ERROR` | SVG rasterization failed |
| `SvgEncodeNotImplementedError` | `SVG_ENCODE_NOT_IMPLEMENTED` | Converting to SVG output is not supported |

---

## @webcvt/cli

| Class | Code | When thrown |
|---|---|---|
| `CliBadUsageError` | `BAD_USAGE` | CLI arguments are invalid or missing required values |
| `CliInputTooLargeError` | `INPUT_TOO_LARGE` | Input file exceeds the CLI's size limit |
