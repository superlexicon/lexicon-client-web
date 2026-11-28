import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = import.meta.dirname || fileURLToPath(new URL('.', import.meta.url));
const PHYSICAL_SHELLS = new Set(['/index.html', '/apps.html', '/explorer.html', '/app.html']);

function slxUniversalAppHostPlugin() {
  const attach = (server) => {
    server.middlewares.use((req, _res, next) => {
      const cleanPath = (req.url || '').split('?')[0];
      if (
        /^\/app\/[a-z0-9_-]+\/?$/i.test(cleanPath) ||
        (/^\/[a-z0-9_-]+\.html$/i.test(cleanPath) && !PHYSICAL_SHELLS.has(cleanPath.toLowerCase()))
      ) {
        const qs = (req.url || '').includes('?') ? '?' + req.url.split('?')[1] : '';
        req.url = '/app.html' + qs;
      }
      next();
    });
  };
  return {
    name: 'slx-universal-app-host',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

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
  plugins: [slxUniversalAppHostPlugin()],
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
