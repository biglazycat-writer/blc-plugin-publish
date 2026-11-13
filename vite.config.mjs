import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  base: './',
  build: { outDir: '../../dist/ui', emptyOutDir: true, target: 'esnext' },
  test: { include: ['**/*.test.ts', '**/*.test.tsx'], environment: 'jsdom' },
});
