import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.VITE_API_PORT || '3000';
  return {
    base: command === 'build' ? '/exam-grader/' : '/',
    plugins: [vue()],
    server: {
      port: 5177,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          ws: true
        }
      }
    }
  };
});
