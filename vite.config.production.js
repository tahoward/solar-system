import { defineConfig } from 'vite'

export default defineConfig({
  // Base path for GitHub Pages - update this to match your repository name
  // Example: if your repo is 'my-solar-system', use base: '/my-solar-system/'
  base: '/solar-system/',  // Update this to your actual GitHub repository name

  // Build configuration optimized for GitHub Pages
  build: {
    // Output directory
    outDir: 'dist',

    // Generate source maps for debugging
    sourcemap: true,

    // Asset handling
    assetsDir: 'assets',

    // Rollup options for optimization
    rollupOptions: {
      output: {
        // Separate chunks for better caching
        manualChunks: {
          // Three.js and related libraries
          'three-vendor': ['three', 'three.interactive', 'camera-controls'],
          // Animation libraries
          'animation-vendor': ['@tweenjs/tween.js', 'stats-gl']
        }
      }
    },

    // Optimize asset size limits
    chunkSizeWarningLimit: 1000
  },

  // Asset handling configuration
  assetsInclude: ['**/*.jpg', '**/*.png', '**/*.svg', '**/*.tif'],

  // Server configuration for development
  server: {
    open: true,
    port: 3000
  },

  // Preview server configuration
  preview: {
    port: 4173
  }
})