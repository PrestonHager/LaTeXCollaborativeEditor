import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // Google OAuth checks the exact origin, so always serve dev on localhost:5173.
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
});
