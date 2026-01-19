import { defineConfig } from 'vite'
import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { siteContentPlugin } from '@uniweb/build/site'
import { foundationDevPlugin } from '@uniweb/build/dev'

// Read foundation from site.yml
const siteConfig = yaml.load(readFileSync('./site.yml', 'utf8'))
const foundation = siteConfig.foundation || 'default'

// Check if foundation is in the workspace
const foundationPath = `../../foundations/${foundation}`
const isWorkspaceFoundation = existsSync(foundationPath)

const useRuntimeLoading = process.env.VITE_FOUNDATION_MODE === 'runtime'

export default defineConfig({
  resolve: {
    alias: {
      '#foundation': foundation,
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    svgr(),
    siteContentPlugin({
      sitePath: './',
      inject: true,
    }),
    useRuntimeLoading && foundationDevPlugin({
      name: foundation,
      path: isWorkspaceFoundation ? foundationPath : `./node_modules/${foundation}`,
      serve: '/foundation',
      watch: true,
    }),
  ].filter(Boolean),
  server: {
    fs: { allow: ['../..'] },
    port: 3000,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
  },
})
