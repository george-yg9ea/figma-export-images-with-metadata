# AVIF Metadata Injection - Technical Limitation

## Summary

**Current Status:** AVIF export works, but metadata (EXIF/XMP/IPTC) is not preserved in exported AVIF files.

**Reason:** The browser-based AVIF encoder library (`@jsquash/avif`) does not support metadata injection. Implementing it ourselves would require significant development effort.

---

## Why Metadata Injection is Difficult

### 1. **AVIF File Format Complexity**

AVIF files use a complex container format (ISOBMFF - ISO Base Media File Format) that's similar to MP4 video files. Unlike JPEG, which stores metadata in simple APP segments, AVIF stores metadata in specialized "boxes" (also called "atoms") that must be:

- Properly structured according to ISOBMFF specifications
- Correctly linked to the image data
- Validated for format compliance
- Positioned in the correct order within the file structure

### 2. **Encoder Library Limitation**

The `@jsquash/avif` library we use is a WebAssembly port of the `libavif` encoder. It focuses on:
- Image encoding/decoding
- Quality and compression optimization
- Browser compatibility

**It does NOT include:**
- Metadata box creation
- ISOBMFF box structure manipulation
- Metadata format conversion (EXIF/XMP/IPTC → AVIF boxes)

### 3. **What Would Be Required**

To implement metadata injection ourselves, we would need to:

#### A. Parse the AVIF File Structure
- Read and understand the ISOBMFF box structure
- Identify where metadata boxes should be inserted
- Handle different AVIF encoding modes (single image, image sequences, etc.)

#### B. Convert Metadata Formats
- **EXIF → EXIF box**: Convert JPEG EXIF format to AVIF EXIF box format
- **XMP → XMP box**: Convert XMP XML to AVIF XMP box format  
- **IPTC → IPTC box**: Convert IPTC IIM format to AVIF IPTC box format

#### C. Reconstruct the File
- Extract existing boxes from the encoded AVIF
- Insert new metadata boxes in the correct locations
- Rebuild the file structure with proper box ordering
- Validate the final file structure

#### D. Handle Edge Cases
- Different AVIF encoding configurations
- Multiple metadata sources
- Large metadata payloads
- Format validation and error handling

### 4. **Development Effort Estimate**

**If we were to implement this ourselves:**

- **Research & Planning**: 1-2 weeks
  - Study ISOBMFF specification
  - Understand AVIF metadata box formats
  - Design implementation approach

- **Implementation**: 3-4 weeks
  - Build ISOBMFF parser
  - Implement metadata format converters
  - Create box insertion logic
  - Write validation and error handling

- **Testing & Debugging**: 2-3 weeks
  - Test with various image types
  - Handle edge cases
  - Ensure format compliance
  - Browser compatibility testing

**Total: 6-9 weeks of development time**

### 5. **Alternative Solutions**

#### Option A: Wait for Library Support
- Monitor `@jsquash/avif` or `libavif` for metadata support
- **Pros**: No development effort, maintained by library authors
- **Cons**: Timeline uncertain, may never be added

#### Option B: Use Native Tools (Recommended for Production)
- Export JPEG with metadata (already working)
- Use command-line tools (e.g., `avifenc` from libavif) to convert JPEG → AVIF with metadata
- **Pros**: Reliable, well-tested, preserves metadata
- **Cons**: Requires external tool, not browser-based

#### Option C: ExifTool (Not Possible in Browser)
- **What it is**: Powerful Perl-based command-line tool for reading/writing metadata
- **Why it doesn't work**: 
  - Figma plugins run in browser sandbox (cannot execute native programs)
  - ExifTool requires Perl runtime and file system access
  - No browser-compatible JavaScript port exists
- **Could work if**: Used server-side (see Option D)

#### Option D: Server-Side Processing (Best for Metadata)
- Send image to server
- Server uses native tools (ExifTool, `avifenc`, etc.) to:
  - Encode image as AVIF
  - Inject metadata from original JPEG
  - Return AVIF file to client
- **Pros**: 
  - Full metadata support (ExifTool handles all formats)
  - Better performance (native tools are faster)
  - Reliable and well-tested
- **Cons**: 
  - Requires server infrastructure
  - Network dependency
  - Additional hosting costs

---

## Current Workaround

**For users who need AVIF with metadata:**

1. Export as JPEG (metadata preserved) ✅
2. Use external tool to convert JPEG → AVIF with metadata
   - **Option 1**: `avifenc --exif input.jpg output.avif` (libavif)
   - **Option 2**: `exiftool -tagsFromFile input.jpg -all:all output.avif` (ExifTool)
   - **Option 3**: Use image editing software (Photoshop, etc.) that supports AVIF with metadata

---

## Recommendation

**For the Figma plugin:**
- Keep AVIF export as-is (without metadata) for users who need AVIF format
- Document the limitation clearly
- Recommend JPEG export for users who need metadata preservation

**For production workflows requiring AVIF with metadata:**

1. **Client-side (manual)**: Use ExifTool or `avifenc` command-line tools
   ```bash
   # Using ExifTool (most comprehensive)
   exiftool -tagsFromFile input.jpg -all:all output.avif
   
   # Using libavif
   avifenc --exif input.jpg output.avif
   ```

2. **Server-side (automated)**: Build a service that:
   - Receives image from Figma plugin
   - Uses ExifTool or libavif to encode with metadata
   - Returns AVIF file to client
   - **Pros**: Seamless user experience, handles all metadata formats
   - **Cons**: Requires server infrastructure

3. **Hybrid approach**: 
   - Plugin exports JPEG with metadata (fast, works now)
   - Provide optional server endpoint for AVIF conversion
   - Users can choose: fast JPEG export or slower AVIF with metadata via server

---

## Technical References

- [ISOBMFF Specification (ISO/IEC 14496-12)](https://www.iso.org/standard/74428.html)
- [AVIF Specification](https://aomediacodec.github.io/av1-avif/)
- [libavif Documentation](https://github.com/AOMediaCodec/libavif)
- [@jsquash/avif GitHub](https://github.com/jamsinclair/jSquash/tree/main/packages/avif)
- [ExifTool Documentation](https://exiftool.org/) - Native tool for metadata manipulation

---

**Last Updated:** 2025-01-XX  
**Status:** Limitation documented, no immediate plans to implement

