# AVIF Export Feature - Manager Summary

## Why AVIF Export Should Not Be Included in the Plugin

The AVIF export feature works correctly but is **3-5x slower than native Figma exports** (1-4 seconds per image vs. <0.5 seconds), which creates a poor user experience. This performance limitation cannot be resolved because Figma plugins run in browser sandboxes and cannot access native code or system resources—they're limited to JavaScript/WebAssembly, which is inherently slower than native implementations. Additionally, Figma's API doesn't support AVIF natively, requiring us to perform the conversion ourselves using a 3.5MB WebAssembly encoder that must compile and run in the browser. While we've optimized the implementation as much as possible, the fundamental architecture prevents achieving native-level performance. For a plugin focused on fast, reliable exports, this slow performance would lead to user complaints and support burden.

## Recommended Workflow for AVIF Images

**Best Flow:**
1. **Export JPEG from Figma plugin** (fast, with metadata preserved) - Use the existing "Export JPEG" feature which is fast and reliable
2. **Batch convert to AVIF using a separate script** - Use a Node.js script with native `libavif` tools for batch conversion, which is 5-10x faster than browser-based encoding and better suited for processing multiple images

This two-step approach provides the best user experience: fast exports within Figma for immediate use, and efficient batch conversion for AVIF when needed.

