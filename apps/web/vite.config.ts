import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

export default defineConfig({
  root: here,
  plugins: [react()],
  server: { fs: { allow: [root] } },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
