import { defineConfig } from 'vite';

/**
 * Relative base so assets work on GitHub project Pages
 * (e.g. https://user.github.io/world_radioX/) and any subpath.
 * Absolute "/" only works at the domain root.
 */
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
