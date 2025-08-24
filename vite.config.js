import { defineConfig } from 'vite';

export default defineConfig({
  // Let esbuild output modern syntax that supports top-level await
  build: {
    target: 'esnext',
  },
  esbuild: {
    target: 'esnext',
  },
});
