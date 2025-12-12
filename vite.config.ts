import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 10001,
    host: true, // Listen on all interfaces
    strictPort: false, // Try next available port if 10001 is taken
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: undefined,
      },
    },
    chunkSizeWarningLimit: 50,
  },
  optimizeDeps: {
    exclude: ['snarkjs', '@zk-kit/groth16'],
  },
});

