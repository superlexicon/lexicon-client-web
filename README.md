# SuperLexicon Subnet Client Web (`lexicon-client-web`)

Standalone browser client suite, multi-subnet cryptographic Block Explorer, and Haltproof WASM Subroutine (HFS) applications for any SuperLexicon subnet (`LR2021` RF or encrypted `TCP/IP`), bundled with the [`@superlexicon/sdk`](https://github.com/superlexicon/lexicon-js-sdk) submodule.

## Quick Start for Subnet Operators

```bash
git clone --recurse-submodules git@github.com:superlexicon/lexicon-client-web.git
cd lexicon-client-web
npm ci
mkdir -p node_modules/@superlexicon && ln -sfn ../../packages/sdk node_modules/@superlexicon/sdk
npm run dev
```

## Connecting to Your Subnet(s)

1. **Interactive UI Switcher**: Click the **Subnet Selector** pill at the left of the top telemetry bar on any page (`+ Connect Custom Subnet RPC…`) and enter your validator's WebSocket JSON-RPC URL (e.g. `ws://192.168.1.10:8545`).
2. **Static Subnet Directory**: Edit `public/contracts/subnets.json` (and optional deployment manifests in `public/contracts/`) to pre-populate your subnet(s) for all users.
