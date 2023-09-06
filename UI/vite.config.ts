import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [ react() ],
  // to fix "global undefined" error in dev mode (https://github.com/vitejs/vite/issues/7257#issuecomment-1066064513)
  define: { global: "globalThis" }
})
