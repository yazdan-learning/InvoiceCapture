import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev only: the backend's /api through this server, so a phone on the same network can use
    // the app (start with `VITE_API_BASE_URL= npm run dev -- --host`, see README).
    proxy: { '/api': 'http://localhost:4300' }
  }
});


