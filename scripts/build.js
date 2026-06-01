import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await mkdir(dist, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'web', 'app.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: join(dist, 'bundle.js'),
});

await copyFile(join(root, 'web', 'index.html'), join(dist, 'index.html'));
await copyFile(join(root, 'web', 'style.css'), join(dist, 'style.css'));
await copyFile(join(root, 'web', 'favicon.png'), join(dist, 'favicon.png'));
await mkdir(join(dist, 'fonts'), { recursive: true });
for (const f of [
  'SymbolsNerdFontMono.woff2',
  'NotoSansSymbols2.woff2',
]) {
  await copyFile(join(root, 'web', 'fonts', f), join(dist, 'fonts', f));
}
await copyFile(
  join(root, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
  join(dist, 'xterm.css')
);

console.log('build complete -> dist/');
