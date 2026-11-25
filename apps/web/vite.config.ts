import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.API_PORT ?? 3000}`;
const proxy = {
  '/api': api,
  '/auth': api,
  '/dev': api,
  '/socket.io': { target: api, ws: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy },
  preview: { port: Number(process.env.WEB_PORT ?? 4173), strictPort: true, proxy },
});
