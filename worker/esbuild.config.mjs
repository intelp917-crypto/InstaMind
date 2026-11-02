import { build } from 'esbuild';

await build({
  bundle: true,
  entryPoints: ['src/index.ts'],
  entryNames: 'worker',
  outdir: 'dist',
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: false,
  external: [],
  logLevel: 'info'
});
console.log('worker bundled -> dist/worker.js');
