import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    css: {
      postcss: './postcss.config.mjs',
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'import.meta.env.VITE_CLOUDBASE_ENV': JSON.stringify(env.NEXT_PUBLIC_CLOUDBASE_ENV),
      'import.meta.env.VITE_CLOUDBASE_CLIENT_ID': JSON.stringify(env.NEXT_PUBLIC_CLOUDBASE_CLIENT_ID),
      'import.meta.env.VITE_CLOUDBASE_REGION': JSON.stringify(env.NEXT_PUBLIC_CLOUDBASE_REGION),
      'import.meta.env.VITE_CLOUDBASE_ACCESS_KEY': JSON.stringify(env.NEXT_PUBLIC_CLOUDBASE_ACCESS_KEY),
      'import.meta.env.VITE_APP_URL': JSON.stringify(env.APP_URL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // 单独运行 vite 时，将 /api 转发到后端，需先在本机运行 npm run dev（后端占 3001）
        "/api": { target: "http://localhost:3001", changeOrigin: true },
      },
    },
  };
});
