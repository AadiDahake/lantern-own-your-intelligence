import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: 'src/loader.tsx',
      name: 'LanternWidget',
      formats: ['iife'],
      fileName: () => 'lantern.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
