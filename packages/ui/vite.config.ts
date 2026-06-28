import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      // Dev mode: proxy API calls to the running `slsv ui` server
      '/api': 'http://localhost:4567',
    },
  },
})
