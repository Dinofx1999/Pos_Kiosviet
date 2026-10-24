import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@erp/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true }, '/uploads': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: {
    outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], antd: ['antd', '@ant-design/icons'], vendor: ['@tanstack/react-query', 'axios', 'dayjs', 'zustand'] } } },
  },
});
