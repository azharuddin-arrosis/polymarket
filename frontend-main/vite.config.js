import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    port:3000,
    proxy: {
      '/sim1': { target:'http://localhost:8101', changeOrigin:true, rewrite:p=>p.replace(/^\/sim1/,'') },
      '/sim2': { target:'http://localhost:8102', changeOrigin:true, rewrite:p=>p.replace(/^\/sim2/,'') },
      '/real1':{ target:'http://localhost:8201', changeOrigin:true, rewrite:p=>p.replace(/^\/real1/,'') },
      '/real2':{ target:'http://localhost:8202', changeOrigin:true, rewrite:p=>p.replace(/^\/real2/,'') },
    }
  },
  build: { outDir:'dist', chunkSizeWarningLimit:1200 }
})
