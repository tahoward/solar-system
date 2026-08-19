import { defineConfig } from 'vite'

/**
 * Vite configuration for development and ordinary builds.
 *
 * The two settings worth explaining are the relative base and the vendor chunks. A relative
 * `base` lets the build be served from a subdirectory without knowing its path at build time,
 * which absolute URLs would prevent. Splitting Three.js and the animation libraries into their
 * own chunks keeps them out of the application bundle, so they stay cached across deploys
 * instead of being re-downloaded whenever the app code changes — they are also large enough
 * that the default warning limit is raised rather than tripped every build.
 *
 * See [vite.config.production.js](vite.config.production.js) for the release variant.
 */
export default defineConfig({
  base: './',

  build: {
    outDir: 'dist',

    sourcemap: true,

    assetsDir: 'assets',

    rollupOptions: {
      output: {
        manualChunks: {
          'three-vendor': ['three', 'three.interactive', 'camera-controls'],
          'animation-vendor': ['@tweenjs/tween.js', 'stats-gl']
        }
      }
    },

    chunkSizeWarningLimit: 1000
  },

  assetsInclude: ['**/*.jpg', '**/*.png', '**/*.svg', '**/*.tif'],

  server: {
    open: true,
    port: 3000
  },

  preview: {
    port: 4173
  }
})