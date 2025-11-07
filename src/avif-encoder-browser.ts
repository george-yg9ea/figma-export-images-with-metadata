// Browser-compatible AVIF encoder using @jsquash/avif and @jsquash/png
import decodePNG from '@jsquash/png/decode';
import encodeAVIF from '@jsquash/avif/encode';
import { init as initPNG } from '@jsquash/png/decode';
import { init as initAVIF } from '@jsquash/avif/encode';

// Initialize codecs with correct WASM paths
// The WASM files are in dist/avif/codec/ relative to the plugin root
let codecsInitialized = false;

async function loadWasmFromBase64(base64: string): Promise<ArrayBuffer> {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    console.error('[AVIF Encoder] Failed to decode WASM from base64:', error);
    throw error;
  }
}

// Removed loadWasmModule - now using fetch directly in initCodecs

async function initCodecs() {
  if (codecsInitialized) {
    return;
  }
  
  try {
    let pngWasmBuffer: ArrayBuffer | undefined;
    let avifWasmBuffer: ArrayBuffer | undefined;
    
    // First, try to load from embedded base64 (if available)
    if (typeof window !== 'undefined') {
      const pngBase64 = (window as any).__PNG_WASM_BASE64__;
      const avifBase64 = (window as any).__AVIF_WASM_BASE64__;
      
      if (pngBase64) {
        try {
          pngWasmBuffer = await loadWasmFromBase64(pngBase64);
        } catch (error) {
          console.warn('[AVIF Encoder] Failed to load PNG WASM from base64:', error);
        }
      }
      
      if (avifBase64) {
        try {
          avifWasmBuffer = await loadWasmFromBase64(avifBase64);
        } catch (error) {
          console.warn('[AVIF Encoder] Failed to load AVIF WASM from base64:', error);
        }
      }
    }
    
    // Fallback: try to fetch from URLs
    if (!pngWasmBuffer || !avifWasmBuffer) {
      const basePath = './avif/codec/';
      const pathVariations = [basePath, `/${basePath}`, basePath.replace('./', '')];
      
      if (!pngWasmBuffer) {
        for (const base of pathVariations) {
          const pngWasmPath = `${base}png/pkg/squoosh_png_bg.wasm`;
          try {
            const response = await fetch(pngWasmPath);
            if (response.ok) {
              pngWasmBuffer = await response.arrayBuffer();
              break;
            }
          } catch (error) {
            // Silent fail - will try next path
          }
        }
      }
      
      if (!avifWasmBuffer) {
        for (const base of pathVariations) {
          const avifWasmPath = `${base}avif/enc/avif_enc.wasm`;
          try {
            const response = await fetch(avifWasmPath);
            if (response.ok) {
              avifWasmBuffer = await response.arrayBuffer();
              break;
            }
          } catch (error) {
            // Silent fail - will try next path
          }
        }
      }
    }
    
    // Initialize PNG decoder
    if (pngWasmBuffer) {
      // Pass the ArrayBuffer directly to init
      await initPNG(pngWasmBuffer);
    } else {
      throw new Error('Could not load PNG WASM buffer');
    }
    
    // Initialize AVIF encoder
    if (avifWasmBuffer) {
      // Pass options with wasmBinary and locateFile to prevent URL construction
      await initAVIF({
        wasmBinary: new Uint8Array(avifWasmBuffer),
        locateFile: (path: string) => {
          // Return empty string to prevent URL construction
          // The WASM is already provided via wasmBinary
          return '';
        }
      });
    } else {
      throw new Error('Could not load AVIF WASM buffer');
    }
    
    codecsInitialized = true;
  } catch (error) {
    console.error('[AVIF Encoder] Codec initialization error:', error);
    codecsInitialized = false; // Don't mark as initialized if it failed
    throw error;
  }
}

// Initialize on load only if feature is enabled
// When ENABLE_AVIF_EXPORT = false, this module is only loaded via dynamic import
// and won't initialize, so no performance impact when feature is disabled
// Note: With dynamic import, this code is only loaded when explicitly imported
initCodecs().catch((err) => {
  console.error('[AVIF Encoder] Failed to initialize codecs:', err);
});

// Decode PNG bytes to ImageData
async function pngToImageData(pngBytes: Uint8Array): Promise<ImageData> {
  // Ensure codecs are initialized before use
  await initCodecs();
  // No need for setTimeout - initCodecs already ensures initialization is complete
  
  // Validate PNG input
  if (!pngBytes || pngBytes.length === 0) {
    throw new Error('PNG bytes are empty or invalid');
  }
  
  // Check PNG signature (should start with 89 50 4E 47 0D 0A 1A 0A)
  if (pngBytes.length < 8 || 
      pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50 || 
      pngBytes[2] !== 0x4E || pngBytes[3] !== 0x47) {
    throw new Error('Invalid PNG file signature');
  }
  
  const imageData = await decodePNG(pngBytes);
  
  if (!imageData || !imageData.data || imageData.data.length === 0) {
    throw new Error('PNG decoding returned invalid ImageData');
  }
  
  return imageData;
}

// Encode ImageData to AVIF
async function imageDataToAVIF(
  imageData: ImageData,
  quality: number,
  speedOverride?: number
): Promise<Uint8Array> {
  // Ensure codecs are initialized before use
  await initCodecs();
  // No need for setTimeout - initCodecs already ensures initialization is complete
  
  // Speed parameter: 0 = slowest/best quality, 10 = fastest/lower quality
  // If speedOverride is provided, use it directly (for faster encoding)
  // Otherwise, convert quality (0-100) to speed
  let speed: number;
  if (speedOverride !== undefined) {
    speed = Math.max(0, Math.min(10, speedOverride));
  } else {
    // Convert quality (0-100) to speed (0-10)
    // Quality 100 = speed 0 (best), Quality 0 = speed 10 (fastest)
    // For faster encoding, we bias towards higher speeds
    // Quality 50 = speed 6 (faster), Quality 80 = speed 2 (slower)
    speed = Math.round(10 * (1 - quality / 100));
  }
  
  const avifBuffer = await encodeAVIF(imageData, {
    speed,
    // Note: @jsquash/avif doesn't directly support metadata injection
    // Metadata would need to be added post-encoding
  });
  
  // Ensure we return a proper Uint8Array
  if (!avifBuffer) {
    throw new Error('AVIF encoding returned null or undefined');
  }
  
  const result = avifBuffer instanceof Uint8Array 
    ? avifBuffer 
    : new Uint8Array(avifBuffer);
  
  if (result.length === 0) {
    throw new Error('AVIF encoding returned empty buffer');
  }
  
  return result;
}

// Main encode function that matches the expected API
async function encodeAVIFFromPNG(
  pngBytes: Uint8Array,
  options: { quality?: number; speed?: number; exif?: Uint8Array; xmp?: Uint8Array; icc?: Uint8Array } = {}
): Promise<Uint8Array> {
  const { quality = 50, speed, exif, xmp, icc } = options;
  
  try {
    // Step 1: Decode PNG to ImageData
    const imageData = await pngToImageData(pngBytes);
    
    // Step 2: Encode to AVIF (pass speed override if provided)
    let avifBytes = await imageDataToAVIF(imageData, quality, speed);
    
    // Step 3: Inject metadata if provided
    // Note: @jsquash/avif doesn't support metadata directly
    // We would need to parse the AVIF file structure and inject metadata boxes
    // For now, we encode without metadata injection
    // TODO: Add metadata injection using AVIF box structure manipulation
    
    // Note: Metadata (exif, xmp, icc) is not yet injected - see AVIF_METADATA_LIMITATION.md
    
    return avifBytes;
  } catch (error) {
    console.error('[AVIF Encoder] Encoding error:', error);
    throw error;
  }
}

// Expose to window for the UI to use
if (typeof window !== 'undefined') {
  (window as any).AVIF = {
    encode: encodeAVIFFromPNG
  };
  
  // Also dispatch an event to signal readiness
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('avif-encoder-ready'));
  }
}

// Also export for direct import
export { encodeAVIFFromPNG as encode };
export default { encode: encodeAVIFFromPNG };
