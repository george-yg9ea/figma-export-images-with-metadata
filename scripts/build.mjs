import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir, stat, cp, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

let inlinedHtml = '';
// Plugin to replace __html__ with HTML content that has ui.js inlined
const htmlPlugin = {
  name: 'html-replace',
  setup(build) {
    build.onResolve({ filter: /^__html__$/ }, () => ({ path: '__html__', namespace: 'html' }));
    build.onLoad({ filter: /.*/, namespace: 'html' }, async () => {
      return {
        contents: `export default ${JSON.stringify(inlinedHtml)};`,
        loader: 'js'
      };
    });
  }
};

const isWatch = process.argv.includes('--watch');

const root = resolve(process.cwd());
const distDir = resolve(root, 'dist');

async function ensureDir(path) {
  try {
    await mkdir(path, { recursive: true });
  } catch {}
}

async function copyFile(from, to) {
  const data = await readFile(from);
  await ensureDir(dirname(to));
  await writeFile(to, data);
}

await ensureDir(distDir);

// First, build UI bundle (will be rebuilt with WASM later)
await build({
    entryPoints: ['src/ui.ts'],
    outfile: 'dist/ui.js',
    bundle: true,
    minify: false, // Disable minification for easier debugging
    sourcemap: true,
    platform: 'browser',
    target: ['es2019'],
    // Externalize nothing - bundle everything including AVIF encoder
    external: []
});

// Compose HTML with inlined UI JS
{
  const htmlPath = resolve(root, 'src/ui.html');
  const uiJsPath = resolve(root, 'dist/ui.js');
  const [html, uiJs] = await Promise.all([
    readFile(htmlPath, 'utf-8'),
    readFile(uiJsPath, 'utf-8')
  ]);
  inlinedHtml = html.replace('<script src="./ui.js"></script>', `<script>\n${uiJs}\n</script>`);
}

// Build AVIF encoder for browser using @jsquash/avif
// Note: Only embeds WASM if AVIF feature is enabled (check ENABLE_AVIF_EXPORT in ui.ts)
try {
  // Check if AVIF feature is enabled by reading ui.ts
  const uiTsPath = resolve(root, 'src/ui.ts');
  const uiTsContent = await readFile(uiTsPath, 'utf-8');
  const avifEnabled = /const\s+ENABLE_AVIF_EXPORT\s*=\s*true/i.test(uiTsContent);
  
  if (!avifEnabled) {
    console.log('[Build] AVIF export is disabled - skipping WASM embedding (saves ~3.5MB)');
  } else {
    console.log('[Build] AVIF export is enabled - embedding WASM files');
    await mkdir(resolve(distDir, 'avif'), { recursive: true });
    
    // Read WASM files and convert to base64 for embedding
    const pngWasmPath = resolve(root, 'node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm');
    const avifWasmPath = resolve(root, 'node_modules/@jsquash/avif/codec/enc/avif_enc.wasm');
    
    let pngWasmBase64 = '';
    let avifWasmBase64 = '';
    
    try {
      const pngWasm = await readFile(pngWasmPath);
      pngWasmBase64 = pngWasm.toString('base64');
      console.log('[Build] PNG WASM loaded, size:', pngWasm.length, 'bytes');
    } catch (e) {
      console.warn('[Build] Could not read PNG WASM:', e.message);
    }
    
    try {
      const avifWasm = await readFile(avifWasmPath);
      avifWasmBase64 = avifWasm.toString('base64');
      console.log('[Build] AVIF WASM loaded, size:', avifWasm.length, 'bytes');
    } catch (e) {
      console.warn('[Build] Could not read AVIF WASM:', e.message);
    }
    
    // Create a wrapper file that embeds the WASM files
    const encoderWrapperPath = resolve(root, 'src/avif-encoder-wrapper.ts');
    const encoderWrapperContent = `// Auto-generated wrapper with embedded WASM
// This file sets up the base64 WASM strings on the window object
// so they're available when avif-encoder-browser is dynamically imported

// Embed WASM files as base64
export const PNG_WASM_BASE64 = ${JSON.stringify(pngWasmBase64)};
export const AVIF_WASM_BASE64 = ${JSON.stringify(avifWasmBase64)};

// Make them available globally for the encoder to use
// This must be set before avif-encoder-browser is imported
if (typeof window !== 'undefined') {
  (window as any).__PNG_WASM_BASE64__ = PNG_WASM_BASE64;
  (window as any).__AVIF_WASM_BASE64__ = AVIF_WASM_BASE64;
}
`;
    await writeFile(encoderWrapperPath, encoderWrapperContent);
    
    // Update ui.ts to import the wrapper so base64 WASM is available
    // We need to add a static import of the wrapper before the dynamic import
    let updatedUiTs = uiTsContent;
    
    // Add wrapper import if not already present and AVIF is enabled
    if (!uiTsContent.includes("import './avif-encoder-wrapper';") && 
        !uiTsContent.includes("import './avif-encoder-wrapper'")) {
      // Add wrapper import right after the feature flag line
      // This ensures the base64 strings are available before the dynamic import
      updatedUiTs = uiTsContent.replace(
        /(const ENABLE_AVIF_EXPORT = true;\n)/,
        "$1\n// Import wrapper to set up embedded WASM base64 strings\nimport './avif-encoder-wrapper';\n"
      );
    }
    
    if (updatedUiTs !== uiTsContent) {
      await writeFile(uiTsPath, updatedUiTs);
      
      // Rebuild UI with embedded WASM
      try {
        await build({
          entryPoints: ['src/ui.ts'],
          outfile: 'dist/ui.js',
          bundle: true,
          minify: false,
          sourcemap: true,
          platform: 'browser',
          target: ['es2019'],
          external: []
        });
        console.log('[Build] UI with embedded WASM rebuilt successfully');
        
        // Restore original ui.ts
        await writeFile(uiTsPath, uiTsContent);
        
        // Update inlined HTML
        const htmlPath = resolve(root, 'src/ui.html');
        const uiJsPath = resolve(root, 'dist/ui.js');
        const [html, uiJs] = await Promise.all([
          readFile(htmlPath, 'utf-8'),
          readFile(uiJsPath, 'utf-8')
        ]);
        inlinedHtml = html.replace('<script src="./ui.js"></script>', `<script>\n${uiJs}\n</script>`);
      } catch (encoderError) {
        console.error('[Build] Rebuild failed:', encoderError.message);
        // Restore original ui.ts on error
        await writeFile(uiTsPath, uiTsContent);
      }
      
      // Clean up wrapper
      try {
        await unlink(encoderWrapperPath);
      } catch {}
    }
  }
} catch (e) {
  console.warn('[Build] Could not set up AVIF encoder:', e.message);
}

// Copy ui.html (still emit a file for reference) and public assets
// NOTE: Don't copy public/avif/encoder.js here as it would overwrite the built encoder
await copyFile(resolve(root, 'src/ui.html'), resolve(root, 'dist/ui.html'));
try {
  const publicDir = resolve(root, 'public');
  const s = await stat(publicDir);
  if (s.isDirectory()) {
    // Copy public assets but skip avif directory to avoid overwriting built encoder
    const publicFiles = await readdir(publicDir);
    for (const file of publicFiles) {
      if (file !== 'avif') {
        const src = resolve(publicDir, file);
        const dest = resolve(distDir, file);
        const stat = await stat(src);
        if (stat.isDirectory()) {
          await cp(src, dest, { recursive: true });
        } else {
          await copyFile(src, dest);
        }
      }
    }
  }
} catch {}

// Then build main with html inlined
await build({
  entryPoints: ['src/code.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  minify: false, // Disable minification for easier debugging
  sourcemap: true,
  platform: 'browser',
  target: ['es2019'],
  plugins: [htmlPlugin]
});

if (isWatch) {
  // Simple watch: rebuild everything on UI rebuild
  await build({
    entryPoints: ['src/ui.ts'],
    outfile: 'dist/ui.js',
    bundle: true,
    minify: false,
    sourcemap: true,
    platform: 'browser',
    target: ['es2019'],
    watch: {
      async onRebuild(error) {
        if (error) return;
        const [html, uiJs] = await Promise.all([
          readFile(resolve(root, 'src/ui.html'), 'utf-8'),
          readFile(resolve(root, 'dist/ui.js'), 'utf-8')
        ]);
        inlinedHtml = html.replace('<script src="./ui.js"></script>', `<script>\n${uiJs}\n</script>`);
        await build({
          entryPoints: ['src/code.ts'],
          outfile: 'dist/code.js',
          bundle: true,
          minify: false,
          sourcemap: true,
          platform: 'browser',
          target: ['es2019'],
          plugins: [htmlPlugin]
        });
        await copyFile(resolve(root, 'src/ui.html'), resolve(root, 'dist/ui.html'));
      }
    }
  });
}


