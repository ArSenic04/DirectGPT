import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The collaboration/LLM server (server/index.ts). In development Vite proxies
// /api and /yjs to it so the browser only ever talks to one origin.
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 1234);
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  // DirectGPT was a Create React App project that referenced
  // process.env.PUBLIC_URL for static assets; keep that working under Vite.
  define: {
    'process.env.PUBLIC_URL': JSON.stringify(''),
  },
  server: {
    port: CLIENT_PORT,
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${SERVER_PORT}`,
      '/yjs': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  preview: { port: CLIENT_PORT },
  build: {
    outDir: 'build',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
});
