import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // Use absolute paths for deployment
  test: {
    // *.spec.ts under scripts/ are Playwright specs, not vitest tests.
    exclude: ['node_modules/**', 'dist/**', 'scripts/**'],
  },
  server: {
    host: true, // Allow external connections for mobile testing
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    assetsDir: 'assets',
    copyPublicDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['recharts'],
          icons: ['lucide-react']
        }
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  }
});
