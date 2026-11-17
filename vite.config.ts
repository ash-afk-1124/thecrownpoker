import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.SERVER_PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true },
      '/api': { target: `http://localhost:${serverPort}` },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
  },
});
