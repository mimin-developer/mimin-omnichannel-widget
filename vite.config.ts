import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __WIDGET_VERSION__: JSON.stringify(version),
  },
  build: {
    minify: 'oxc',
    lib: {
      entry: fileURLToPath(new URL('./src/widget.tsx', import.meta.url)),
      formats: ['es'],
      fileName: 'omnichannel',
    },
  },
})
