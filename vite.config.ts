import { defineConfig } from 'vite'

// base './' so the production build uses relative URLs and runs fully offline
// from a local folder (opened over file:// or any static host).
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
})
