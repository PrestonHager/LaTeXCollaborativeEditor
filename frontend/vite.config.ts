import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  server: {
    // Google OAuth checks the exact origin, so always serve dev on localhost:5173.
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
});
