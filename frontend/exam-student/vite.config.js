import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.VITE_API_PORT || '3000';
  return {
    // 凡执行 vite build 均带子路径前缀，避免服务器上 mode 非 production 时仍打成 /assets/
    base: command === 'build' ? '/exam-student/' : '/',
    plugins: [vue()],
    server: {
      port: 5176,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true }
      }
    }
  };
});
