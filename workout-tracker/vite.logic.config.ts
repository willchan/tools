import { defineConfig } from 'vite';

/**
 * The workout reducer as one plain script for the iOS app to run in
 * JavaScriptCore (no DOM, no module loader): src/native/workoutLogicBundle.ts
 * as an IIFE defining the global `WorkoutLogic`. Built after the app into
 * dist/native/, so `cap sync` ships it in the app bundle. Readable like the
 * app build: no minification, with a sourcemap.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/native',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'src/native/workoutLogicBundle.ts',
      formats: ['iife'],
      name: 'WorkoutLogic',
      fileName: () => 'workout-logic.js',
    },
  },
});
