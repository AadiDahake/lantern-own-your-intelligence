import { defineConfig } from 'vite';

/** The scanner alone, injected by the explorer. Built beside the widget into the same dist. */
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    emptyOutDir: false,
    lib: {
      entry: 'src/scan/standalone.ts',
      name: 'LanternScanner',
      formats: ['iife'],
      fileName: () => 'scanner.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
