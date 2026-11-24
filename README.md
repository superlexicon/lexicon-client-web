# SuperLexicon Subnet Client Web (`lexicon-client-web`)

Standalone, zero-backend browser client suite, multi-subnet cryptographic Block Explorer, and Haltproof WASM Subroutine (HFS) applications for **any SuperLexicon subnet** (`LR2021` RF radio or encrypted `TCP/IP` mesh).

This repository contains **no presentation slides** and **no centralized database or cloud backend** — every page connects directly from the user's browser to your subnet validator nodes via [`@superlexicon/sdk`](https://github.com/superlexicon/lexicon-js-sdk) (included as a Git submodule at `packages/sdk`).

---

## What Is Included

| Page / Route | Description | Underlying WASM HFS Artifacts (`public/contracts/`) |
| :--- | :--- | :--- |
| **`/` (`index.html`)** | **Subnet Client Hub & Explorer** — 10-card HFS App Launcher + embedded live Multi-Subnet Block Explorer | `hfs_registry.wasm`, `identity.wasm` |
| **`/explorer.html`** | **Full-Screen Block Explorer & Quorum Verifier** — Universal search (`txHash`, `Block #`, `Address`), multi-validator BFT quorum check, live Cross-Subnet Bridge monitor, and Subnet HFS Directory | Direct JSON-RPC + Pub/Sub WS |
| **`/accounting.html`** | **IFRS & Confidential Accounting Ledger** — Double-entry IAS/IFRS statements, ElGamal homomorphic encrypted balances, Bulletproofs zero-knowledge trial balance & selective auditor disclosure | `accounting_ledger.wasm`, `confidential_ledger.wasm` |
| **`/charter.html`** | **CorporateCharter & Share Capital** — Statutory board/shareholder governance, multi-stage authorizations, and 3-window ROFR + Tag-Along share transfer call auctions | `corporate_charter.wasm`, `share_capital.wasm`, `authorization.wasm` |
| **`/dex.html`** | **DEX Central Limit Order Book** — Multi-market on-chain CLOB orderbooks, deterministic batch matching & corporate futures underwriting | `dex_clob.wasm`, `asset_ledger.wasm` |
| **`/commerce.html`** | **E-Commerce Storefront** — `ProductLedger` SKU inventory & atomic double-entry retail settlement | `product_ledger.wasm`, `accounting_ledger.wasm` |
| **`/ballot.html`** | **CipherVote Secret Ballot** — Threshold homomorphic encrypted tallying & zero-knowledge ballot validity proofs | `secret_ballot.wasm` |
| **`/social.html`** | **CommonsRF Social & ECIES Comms** — Mutual-handshake encrypted DMs, multi-topic AES-256-GCM channels & guilds | `social_charter.wasm`, `social_relationships.wasm`, `social_feed.wasm`, `messaging.wasm` |
| **`/battleship.html`** | **Phantom Fleet** — Real-time 100-player deterministic naval warfare | `battleship.wasm` |
| **`/cipher-noir.html`** | **Cipher Noir** — Arbiter-free mental poker & zero-knowledge cryptographic deduction | `cipher-noir.wasm` |
| **`/hegemony.html`** | **Fractured Hegemony** — Simultaneous committed grand strategy & verifiable diplomacy | `hegemony.wasm` |
| **`/lottery.html`** | **Quantum 4D Jackpot** — Validator-quorum threshold VRF provably fair draw rounds | `lottery.wasm`, `vrf_beacon.wasm` |

Every page also mounts the **Unified SuperLexicon Header** with:
- **Multi-Subnet Selector** & real-time 4-phase BFT consensus telemetry bar (`P1 TX → P2 VOTE → P3 PROP → P4 FIN`, TPS, mempool, validator count),
- **Self-Sovereign Multi-Device Identity & Wallet Manager** (supporting multi-device owner keys and Pedersen-VSS keychain-sharded social key recovery),
- **Cross-App Network & Encrypted Messaging** drawers.

---

## 1. Clone With Submodules

Because `@superlexicon/sdk` is linked as a Git submodule at `packages/sdk`, always clone recursively:

```bash
git clone --recurse-submodules https://github.com/superlexicon/lexicon-client-web.git
cd lexicon-client-web
```

If you already cloned without `--recurse-submodules`, initialize the SDK submodule via:

```bash
git submodule update --init --recursive
```

---

## 2. Pointing the Client at Your Subnet(s)

You can connect the client to your own subnet validators in two ways:

### Option A — Zero-Code UI Switcher (In Browser)
1. Click the **Subnet Selector** pill on the left side of the top telemetry bar on any page (e.g. `📡 SUBNET 1 • RF ▾`).
2. Click **`+ Connect Custom Subnet RPC…`**.
3. Enter a display name and your validator's WebSocket/HTTP JSON-RPC endpoint (e.g. `ws://192.168.1.10:8545` or `wss://rpc.your-subnet.org/rpc`) and click **Connect & Switch Subnet**.

### Option B — Pre-Configure `public/contracts/subnets.json` (For All Visitors)
Edit `public/contracts/subnets.json` before building/deploying so your subnet(s) appear automatically in the Subnet Selector dropdown for all users:

```json
{
  "subnets": [
    {
      "key": "my-lan-subnet",
      "name": "Production Subnet A (TCP Mesh)",
      "shortLabel": "SUBNET A • TCP",
      "transport": "tcp",
      "subnetId": "a1b2c3d4",
      "rpcUrl": "ws://192.168.1.10:8545",
      "pubsubWsUrls": [
        "ws://192.168.1.10:8566",
        "ws://192.168.1.11:8566"
      ],
      "validatorNodes": [
        { "name": "Validator 1", "url": "ws://192.168.1.10:8545" },
        { "name": "Validator 2", "url": "ws://192.168.1.11:8545" },
        { "name": "Validator 3", "url": "ws://192.168.1.12:8545" }
      ],
      "manifestUrl": "/contracts/my-subnet-deployments.json"
    }
  ]
}
```

#### Validator Port & HTTPS/WSS Notes
- **JSON-RPC Port (`api.jsonrpc.port`, default `8545`)**: Speaks both HTTP POST and WebSocket JSON-RPC (`cors_enabled: true`).
- **Real-Time Pub/Sub Telemetry Port (`api.websocket.port`, default `8566` or `8546`)**: Streams `newHeads`, `logs`, and 4-phase consensus `stats`.
- **HTTPS Deployments**: Modern browsers block mixed `ws://` connections from `https://` pages. If you serve `lexicon-client-web` over `https://`, terminate TLS (`wss://`) in front of your validator RPC/WS ports (e.g. with Nginx or Caddy).

---

## 3. Deployment Options

### Option 1 — Local Development Server (Node.js 20+)

```bash
npm ci
mkdir -p node_modules/@superlexicon && ln -sfn ../../packages/sdk node_modules/@superlexicon/sdk
npm run dev
```
Vite will start on `http://localhost:5173` (and bind to LAN interfaces via `--host` so other machines on your network can test directly).

### Option 2 — Static Production Bundle (Any Web Server / CDN)

```bash
npm ci
mkdir -p node_modules/@superlexicon && ln -sfn ../../packages/sdk node_modules/@superlexicon/sdk
npm run build
```
This compiles a pure static bundle into `dist/`. Serve `dist/` from any static web server (Nginx, Caddy, Apache, Cloudflare Pages, S3, etc.) using the included `nginx.conf` security headers as a reference.

### Option 3 — Production Hardened Docker + Nginx Container

Build the multi-stage Node 20 + `nginx:alpine` image and launch it with one command:

```bash
./build.sh
./deploy.sh
```

Environment variables supported by `build.sh` and `deploy.sh`:
- `IMAGE_NAME` (default: `superlexicon-client-web:latest` — set to `your-registry:5000/lexicon-client-web:latest` and `docker push` if deploying across remote hosts)
- `CONTAINER_NAME` (default: `superlexicon-client-web`)
- `HOST_PORT` (default: `3200`)
- `BIND_ADDR` (optional: e.g. `0.0.0.0` or a specific LAN IP; defaults to `127.0.0.1` + detected private RFC1918/Tailscale interfaces)

---

## 4. Deploying HFS Smart Contracts on a Fresh Subnet

All compiled Haltproof WASM Subroutine binaries (`*.wasm` + `*.meta.json`) are pre-bundled in `public/contracts/`. On a brand-new subnet:
1. Open any HFS application page (e.g. `/dex.html`, `/charter.html`, `/battleship.html`, `/accounting.html`).
2. Click the **Identity / Wallet** pill in the top-right header to generate a local `secp256k1` keypair ($0.00 gas) and deploy your on-chain `Identity` contract in 1 block.
3. Use the **`+ New`** button in the HFS instance selector bar at the top of each app to deploy and register fresh HFS instances directly from your browser, or pre-populate contract addresses in your subnet's manifest JSON (`public/contracts/<subnet>-deployments.json`).
