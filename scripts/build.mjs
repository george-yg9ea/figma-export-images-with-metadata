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

// Build UI bundle
await build({
    entryPoints: ['src/ui.ts'],
    outfile: 'dist/ui.js',
    bundle: true,
    minify: false, // Disable minification for easier debugging
    sourcemap: true,
    platform: 'browser',
    target: ['es2019'],
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

// Copy ui.html and public assets
await copyFile(resolve(root, 'src/ui.html'), resolve(root, 'dist/ui.html'));
try {
  const publicDir = resolve(root, 'public');
  const s = await stat(publicDir);
  if (s.isDirectory()) {
    const publicFiles = await readdir(publicDir);
    for (const file of publicFiles) {
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


