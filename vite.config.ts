import { defineConfig } from 'vite';

/**
 * Relative base so assets work on GitHub project Pages
 * (e.g. https://user.github.io/world_radioX/) and any subpath.
 * Absolute "/" only works at the domain root.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
