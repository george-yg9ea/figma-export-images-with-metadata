# Export Images with Metadata (Figma Plugin)

Export cropped/resized images while retaining the original JPEG metadata (EXIF/XMP/IPTC) by merging it back into the rendered export.

**Current focus:** JPEG export with full metadata preservation.

## Install & Build

1. Install deps:

```bash
npm install
```

2. Build once or watch:

```bash
npm run build
# or
npm run watch
```

3. In Figma: Plugins → Development → Import plugin from manifest… and select `manifest.json`.

## Usage

- Select a node that has an `IMAGE` fill (e.g., a rectangle/frame with a cropped image fill).
- Run the plugin: Plugins → Development → Export Images with Metadata.
- Click “Export JPEG”. A file will be downloaded with the original metadata preserved.

Notes:
- This merges APP1 (EXIF/XMP), APP2 (ICC), APP13 (IPTC), and COM from the originally uploaded asset into the newly rendered JPEG. JFIF is kept from the rendered file.
- Some Figma images may not include original metadata if the source lacked it or if Figma provided a recompressed asset without metadata.
- Width/height fields inside EXIF are not rewritten in v0.1; most consumers ignore any mismatch.

## Roadmap
- Optional rewrite of EXIF ImageWidth/ImageLength to match the cropped export.
- Batch export for multiple selections.

## Limitations
- Depends on Figma exposing original bytes with metadata for the image hash; behavior can vary based on how the image entered the file.


