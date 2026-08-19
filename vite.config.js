import { defineConfig } from 'vite'

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