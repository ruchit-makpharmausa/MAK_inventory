import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const port = process.env.PORT || loadEnv(mode, process.cwd(), 'PORT').PORT || '567';
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${port}`,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyRequest, request) => {
              if (!request.headers.origin || !request.headers.host) return;
              let origin;
              try {
                origin = new URL(request.headers.origin);
              } catch {
                return;
              }
              if (['http:', 'https:'].includes(origin.protocol) && origin.host === request.headers.host) {
                proxyRequest.removeHeader('origin');
              }
            });
          },
        },
      },
    },
  };
});
