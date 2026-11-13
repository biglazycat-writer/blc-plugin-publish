import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  base: './',
  build: { outDir: '../../dist/ui', emptyOutDir: true, target: ['es2022', 'chrome109', 'safari16.4'] },
  test: { include: ['**/*.test.ts', '**/*.test.tsx'], environment: 'jsdom' },
});
