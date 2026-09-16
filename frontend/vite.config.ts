import { defineConfig, mergeConfig } from 'vite'
import { defineConfig as defineTestConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const viteConfig = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})

const testConfig = defineTestConfig({
  test: {
    // Use jsdom so all tests have DOM APIs (sessionStorage, localStorage, window, document)
    environment: 'jsdom',
    globals: true,
    // vmThreads keeps jsdom created once per worker (better performance)
    pool: 'vmThreads',
  },
})

export default mergeConfig(viteConfig, testConfig)
