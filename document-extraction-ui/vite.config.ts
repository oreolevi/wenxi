import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  define: { __WENXI_DEMO__: JSON.stringify(mode === 'demo'), __WENXI_CLOUD__: JSON.stringify(mode === 'live') },
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2200 },
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  preview: { host: '127.0.0.1', port: 4178, strictPort: true },
}));
