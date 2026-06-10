import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 须与 backend/.env 的 PORT 一致；未配置时默认 3000，若后端在 3002 请设 VITE_API_PORT=3002 并重启 dev
  const apiPort = env.VITE_API_PORT || '3000';
  // 生产必须与线上挂载路径一致（默认 /exam-super-admin/）。勿用 ./ ：深层路由下资源会变成 …/grading-system/statistics/assets/xxx.js 导致 404 返回 HTML，触发「MIME type text/html」白屏。
  const prodBase = env.VITE_EXAM_SUPER_ADMIN_BASE
    ? (String(env.VITE_EXAM_SUPER_ADMIN_BASE).endsWith('/')
        ? env.VITE_EXAM_SUPER_ADMIN_BASE
        : `${env.VITE_EXAM_SUPER_ADMIN_BASE}/`)
    : '/exam-super-admin/';
  return {
    base: command === 'build' ? prodBase : '/',
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: 5178,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
        '/uploads': { target: `http://localhost:${apiPort}`, changeOrigin: true }
      }
    }
  };
});
