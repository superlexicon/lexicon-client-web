import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    __SLX_HAS_SLIDES__: JSON.stringify(false),
  },
  resolve: {
    alias: [
      {
        find: '@superlexicon/sdk/ui/styles.css',
        replacement: resolve(__dirname, 'packages/sdk/src/ui/styles.css'),
      },
      {
        find: '@superlexicon/sdk/ui',
        replacement: resolve(__dirname, 'packages/sdk/src/ui/index.js'),
      },
      {
        find: /^@superlexicon\/sdk\/(.+)$/,
        replacement: resolve(__dirname, 'packages/sdk/src/$1.js'),
      },
      {
        find: '@superlexicon/sdk',
        replacement: resolve(__dirname, 'packages/sdk/src/index.js'),
      },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        explorer: resolve(__dirname, 'explorer.html'),
        battleship: resolve(__dirname, 'battleship.html'),
        social: resolve(__dirname, 'social.html'),
        dex: resolve(__dirname, 'dex.html'),
        charter: resolve(__dirname, 'charter.html'),
        commerce: resolve(__dirname, 'commerce.html'),
        hegemony: resolve(__dirname, 'hegemony.html'),
        cipherNoir: resolve(__dirname, 'cipher-noir.html'),
        lottery: resolve(__dirname, 'lottery.html'),
        ballot: resolve(__dirname, 'ballot.html'),
        accounting: resolve(__dirname, 'accounting.html'),
        rewards: resolve(__dirname, 'rewards.html'),
      },
    },
  },
  server: {
    host: true,
  },
});
