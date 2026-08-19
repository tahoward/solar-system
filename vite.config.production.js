import { defineConfig } from 'vite'

/**
 * Vite configuration for the deployed build.
 *
 * Differs from [vite.config.js](vite.config.js) in three ways, all of them about publishing
 * rather than building. The base path is fixed to the subdirectory the site is hosted under,
 * which the relative base cannot express here because the app is served from a path the
 * bundler has to know. Source maps are off, so the original sources are not published
 * alongside the bundle. And TIFF is dropped from the asset list, since nothing shipped uses it.
 */
export default defineConfig({
  base: '/solar-system/',

  build: {
    outDir: 'dist',

    sourcemap: false,

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

  assetsInclude: ['**/*.jpg', '**/*.png', '**/*.svg'],

  server: {
    open: true,
    port: 3000
  },

  preview: {
    port: 4173
  }
})