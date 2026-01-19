import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { resolve } from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react(), svgr()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/entry-runtime.js'),
      formats: ['es'],
      fileName: 'foundation',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
    sourcemap: true,
    cssCodeSplit: false,
  },
})
