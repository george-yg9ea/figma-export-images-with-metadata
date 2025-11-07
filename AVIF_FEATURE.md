# AVIF Export Feature - Documentation

## Status: **DISABLED BY DEFAULT**

The AVIF export feature is implemented and functional, but **disabled by default** due to performance limitations that cannot be resolved within the Figma plugin architecture.

**Performance Impact When Disabled:** ✅ **NONE** - The feature is completely excluded from the bundle:
- WASM files are not embedded (saves ~3.5MB)
- Encoder code is not loaded (dynamic import only)
- No initialization overhead
- Plugin loads at native speed

---

## Why It's Disabled

- **Performance:** 3-5x slower than native Figma exports (1-4 seconds vs <0.5 seconds per image)
- **Architecture Limitation:** Figma plugins run in browser sandboxes and cannot access native code
- **User Experience:** Slow performance creates poor UX and potential user complaints
- **Technical Constraint:** Browser WebAssembly is inherently slower than native implementations

See `AVIF_EXPORT_SUMMARY.md` for detailed technical analysis.

---

## How to Enable (For Testing/Development)

If you need to enable AVIF export for testing or specific use cases, follow these steps:

### Step 1: Enable Feature Flag in `src/ui.ts`

Change line 12:
```typescript
const ENABLE_AVIF_EXPORT = false;  // Change to true
```

### Step 2: Enable Feature Flag in `src/code.ts`

Change line 8:
```typescript
const ENABLE_AVIF_EXPORT = false;  // Change to true
```

### Step 3: Rebuild the Plugin

```bash
npm run build
```

### Step 4: Reload Plugin in Figma

1. In Figma: Plugins → Development → Import plugin from manifest
2. Select `manifest.json` again to reload

The "Export AVIF (beta)" button will now appear in the plugin UI.

---

## Current Implementation Details

### What Works
- ✅ AVIF encoding using `@jsquash/avif` WebAssembly encoder
- ✅ PNG to AVIF conversion
- ✅ File download
- ✅ Quality and speed controls

### What Doesn't Work
- ❌ Metadata injection (EXIF/XMP/ICC) - not yet implemented
- ❌ Native-level performance - cannot be achieved

### Performance Characteristics
- **First export:** 3-8 seconds (includes WASM compilation)
- **Subsequent exports:** 1-4 seconds per image
- **Bundle size impact:** +3.5MB (AVIF encoder WASM)

---

## Code Structure

### Files Involved
- `src/ui.ts` - UI logic and feature flag
- `src/code.ts` - Main thread logic and feature flag
- `src/ui.html` - UI markup (button hidden by default)
- `src/avif-encoder-browser.ts` - AVIF encoder implementation
- `scripts/build.mjs` - Build script that embeds WASM files

### Feature Flag Locations
1. `src/ui.ts` line 12: `const ENABLE_AVIF_EXPORT = false;`
2. `src/code.ts` line 8: `const ENABLE_AVIF_EXPORT = false;`

### Conditional Loading
- AVIF encoder is only imported when `ENABLE_AVIF_EXPORT = true`
- This prevents loading the 3.5MB WASM encoder when not needed
- UI button visibility is controlled by the feature flag

---

## Future Considerations

### When to Re-enable
Consider enabling if:
- Figma adds native AVIF support to their API
- Browser performance improves significantly
- User demand justifies the performance tradeoff
- Alternative faster encoding methods become available

### Potential Improvements
- Metadata injection implementation (EXIF/XMP/ICC into AVIF)
- Further speed optimizations (though limited by architecture)
- Progressive encoding for large images
- Background processing using Web Workers

---

## Alternative Solution

For production use, we recommend:

1. **Export JPEG from plugin** (fast, with metadata)
2. **Batch convert to AVIF** using a separate Node.js script with native `libavif` tools

This approach provides:
- Fast exports within Figma
- Efficient batch conversion (5-10x faster than browser WASM)
- Better user experience

---

## Testing

If you enable the feature for testing:

1. Test with various image sizes (small, medium, large)
2. Monitor performance and user feedback
3. Document any issues encountered
4. Consider disabling again if performance complaints arise

---

**Last Updated:** $(date)  
**Status:** Feature implemented but disabled by default  
**Maintainer:** Development Team

