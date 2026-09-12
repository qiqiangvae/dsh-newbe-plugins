import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('lib', { recursive: true });

const host = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  external: ['@deepseek-ai/*'],
};

await build({ ...host, entryPoints: ['src/index.ts'], outfile: 'lib/index.js' });
await build({ ...host, entryPoints: ['src/typert.ts'], outfile: 'lib/typert.host.js' });

await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: ['es2022'],
  jsx: 'automatic',
  external: [
    '@deepseek-ai/*',
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'scheduler',
  ],
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'dsh-newbe-ide', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: { js: 'return module.exports; } });' },
});

console.log('[dsh-newbe-ide build] done: lib/index.js, lib/typert.host.js, lib/client.js');
