import { defineConfig } from 'vite'

/**
 * Library build: ESM bundle in `dist/jrpg-ui.js`, the default pixel-art theme in
 * `dist/jrpg-ui-dialog.css`, and type declarations emitted by `tsc` afterwards.
 * The dev server serves the playground from `example/`.
 */
export default defineConfig({
  root: 'example',
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: '../dist',
    emptyOutDir: true,
    lib: {
      entry: '../src/index.ts',
      formats: ['es'],
      fileName: 'jrpg-ui',
      cssFileName: 'jrpg-ui-dialog',
    },
  },
})
