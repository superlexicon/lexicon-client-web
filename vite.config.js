import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = import.meta.dirname || fileURLToPath(new URL('.', import.meta.url));

function discoverHtmlInputs(dir) {
  const inputs = {};
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.html')) continue;
    const key = name === 'index.html' ? 'main' : name.slice(0, -5);
    inputs[key] = resolve(dir, name);
  }
  return inputs;
}

export default defineConfig({
  define: {
    __SLX_HAS_SLIDES__: JSON.stringify(false),
  },
  resolve: {
    alias: [
      {
        find: /^@superlexicon\/sdk\/(.+\.css)$/,
        replacement: resolve(rootDir, 'packages/sdk/src/$1'),
      },
      {
        find: /^@superlexicon\/sdk\/ui$/,
        replacement: resolve(rootDir, 'packages/sdk/src/ui/index.js'),
      },
      {
        find: /^@superlexicon\/sdk\/(.+)$/,
        replacement: resolve(rootDir, 'packages/sdk/src/$1.js'),
      },
      {
        find: /^@superlexicon\/sdk$/,
        replacement: resolve(rootDir, 'packages/sdk/src/index.js'),
      },
    ],
  },
  build: {
    rollupOptions: {
      input: discoverHtmlInputs(rootDir),
    },
  },
  server: {
    host: true,
  },
});
