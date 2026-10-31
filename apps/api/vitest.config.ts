import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// esbuild does not emit decorator metadata, which Nest's DI needs; SWC does.
export default defineConfig({
  test: { include: ['test/**/*.spec.ts'], testTimeout: 30_000 },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
