import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = import.meta.dirname || fileURLToPath(new URL('.', import.meta.url));

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
      input: {
        main: resolve(rootDir, 'index.html'),
        apps: resolve(rootDir, 'apps.html'),
        explorer: resolve(rootDir, 'explorer.html'),
        battleship: resolve(rootDir, 'battleship.html'),
        social: resolve(rootDir, 'social.html'),
        dex: resolve(rootDir, 'dex.html'),
        charter: resolve(rootDir, 'charter.html'),
        commerce: resolve(rootDir, 'commerce.html'),
        hegemony: resolve(rootDir, 'hegemony.html'),
        cipherNoir: resolve(rootDir, 'cipher-noir.html'),
        lottery: resolve(rootDir, 'lottery.html'),
        ballot: resolve(rootDir, 'ballot.html'),
        accounting: resolve(rootDir, 'accounting.html'),
        rewards: resolve(rootDir, 'rewards.html'),
        crowdfunding: resolve(rootDir, 'crowdfunding.html'),
        telephony: resolve(rootDir, 'telephony.html'),
        volatileVoles: resolve(rootDir, 'volatile-voles.html'),
      },
    },
  },
  server: {
    host: true,
  },
});
