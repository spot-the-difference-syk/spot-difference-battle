import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import aitDevtools from '@apps-in-toss/devtools/unplugin'

export default defineConfig({
  plugins: [
    aitDevtools.vite(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@spot-battle/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    host: true,
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
