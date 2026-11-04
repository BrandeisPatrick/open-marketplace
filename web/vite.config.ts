import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API/MCP server (server/) listens on 3001; the dev server proxies to it so the
// browser talks to a single origin (no CORS, SSE streams pass straight through).
// API_PROXY_TARGET overrides it, e.g. to point at the mock on another port.
const API = process.env.API_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/mcp': { target: API, changeOrigin: true },
    },
  },
});
