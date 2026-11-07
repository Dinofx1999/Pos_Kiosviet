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
    rollupOptions: {
      output: {
        // react (kể cả jsx-runtime) tách riêng để web bán hàng /shop chỉ tải react + gói shop, không kéo antd / vendor của trang quản lý
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](antd|@ant-design[\\/]icons)[\\/]/.test(id)) return 'antd';
          if (/[\\/]node_modules[\\/](@tanstack[\\/]react-query|@tanstack[\\/]query-core|axios|dayjs|zustand)[\\/]/.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
