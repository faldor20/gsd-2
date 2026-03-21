import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const serverPort = Number(process.env.PORT ?? 3000);

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  dev: {
    allowedHosts: ['localhost', 'nixos-lenovo-7'],
  },
  server: {
    host: "0.0.0.0",
    port: serverPort,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/ws/browser': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
    allowedHosts: ['localhost', 'nixos-lenovo-7'],
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.VITE_PREVIEW_PORT ?? 4173),
    allowedHosts: ['localhost', 'nixos-lenovo-7'],
  },
});
