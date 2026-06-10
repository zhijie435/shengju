import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.VITE_API_PORT || '3000';
  return {
    base: command === 'build' ? '/exam-admin/' : '/',
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: 5174,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
        '/uploads': { target: `http://localhost:${apiPort}`, changeOrigin: true }
      }
    }
  };
});
