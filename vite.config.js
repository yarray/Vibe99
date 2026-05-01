import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/index.html',  // Vite resolves .ts imports automatically
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
