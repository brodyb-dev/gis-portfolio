import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    // MapLibre is most of the bundle; keep it in its own long-cached chunk.
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } },
    chunkSizeWarningLimit: 1100,
  },
});
