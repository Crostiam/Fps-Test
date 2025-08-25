import { defineConfig } from 'vite';
export default defineConfig({
  base: '/Fps-Test/', // <-- update to your repo name!
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' }
});
