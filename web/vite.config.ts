import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5299,
    proxy: {
      // Local dev against the wrangler worker on :8787
      '/api': 'http://localhost:8787',
      '/oauth': 'http://localhost:8787',
      '/webhook': 'http://localhost:8787'
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
