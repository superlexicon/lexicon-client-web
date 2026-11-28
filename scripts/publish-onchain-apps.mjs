#!/usr/bin/env node
/**
 * SuperLexicon Zero-Redeploy On-Chain App & Media Publisher (`scripts/publish-onchain-apps.mjs`)
 *
 * Usage:
 *   /home/mano/.local/bin/node scripts/publish-onchain-apps.mjs [slug...]
 *
 * Packs `.html.gz` UI bundles + `#slx-bundle-assets` content-addressed media manifests, then
 * deduplicates and uploads in pipelined ordered batches:
 *   1. `.jpg/.webp/.png/.svg` artwork blobs -> `UI_BUNDLE_STORE` (`0x0101`)
 *   2. `.html.gz` UI bundles -> `UI_BUNDLE_STORE` (`0x0101`)
 *   3. App metadata (`uiHash`, `defaultHfsAddr`, `wasmCodeHash`, `version`) -> `AppStore` HFS
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  hexToBytes,
  bytesToHex,
  concatBytes,
  keccak256Hex,
  computeAddress,
  signOrderedLexiconTx,
  slxNodeRpc,
  slxWaitForReceipt,
  UI_BUNDLE_STORE_ADDRESS,
  UI_BUNDLE_MULTIPART_MAGIC,
  UI_BUNDLE_RADIO_SAFE_PART_BYTES,
  splitBundleIntoChunks,
  AppStoreAbi,
  AppStoreClient,
  ZERO_ADDR,
  ZERO_BYTES32,
} from '../packages/sdk/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(WEB_ROOT, 'public/contracts');
const MANIFEST_PATH = path.join(CONTRACTS_DIR, 'subnet1-deployments.json');
const APP_MANIFEST_PATH = path.join(WEB_ROOT, 'public/app-bundles/manifest.json');

const S1_NODES = [
  'ws://192.168.50.91:8545',
  'ws://192.168.50.92:8555',
  'ws://192.168.50.93:8545',
  'ws://192.168.50.94:8545',
];
const PRIMARY_RPC = process.env.SLX_RPC_URL || 'ws://192.168.50.93:8545';
const OPERATOR_PRIV =
  process.env.SLX_OPERATOR_PRIV ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function sendOrderedBatch(txSpecs) {
  if (!txSpecs.length) return [];
  const eoa = computeAddress(OPERATOR_PRIV).toLowerCase();
  let nonce = BigInt(await slxNodeRpc(PRIMARY_RPC, 'eth_getTransactionCount', [eoa, 'latest']));
  let prevHash = undefined;
  const signedList = [];

  for (const sp of txSpecs) {
    const uniqExtra = Array.from(
      new Set([sp.to, ...(sp.extraTargets || [])].filter(Boolean).map((a) => a.toLowerCase()))
    );
    const signed = signOrderedLexiconTx({
      privateKey: OPERATOR_PRIV,
      nonce,
      to: sp.to,
      data: sp.data,
      gasLimit: sp.gasLimit || 8_500_000n,
      chainId: 1337n,
      extraTargets: uniqExtra,
      ...(prevHash ? { lowerBoundHashHex: prevHash } : {}),
    });
    nonce += 1n;
    prevHash = signed.txHash;
    signedList.push({ ...sp, signed });
  }

  for (const item of signedList) {
    await Promise.allSettled(
      S1_NODES.map((u) => slxNodeRpc(u, 'eth_sendRawTransaction', [item.signed.raw], 4500))
    );
  }

  const rcpts = [];
  for (const item of signedList) {
    const rcpt = await slxWaitForReceipt((m, p) => slxNodeRpc(PRIMARY_RPC, m, p), item.signed.txHash, {
      timeoutMs: 60_000,
      fallbackPollMs: 350,
    });
    if (!rcpt || rcpt.status !== '0x1') {
      throw new Error(`Tx reverted on ${item.label}: ${JSON.stringify(rcpt)}`);
    }
    rcpts.push(rcpt);
  }
  const lastBlk = Number(BigInt(rcpts[rcpts.length - 1].blockNumber));
  console.log(`  ✓ Batch (${signedList.length} txs) sealed @ blk #${lastBlk}: ${signedList.map((x) => x.label).join(', ')}`);
  return rcpts;
}

function build0x0101TxSpecs(labelName, expectedHash, rawBytes) {
  const hashBytes = hexToBytes(expectedHash);
  if (rawBytes.length <= UI_BUNDLE_RADIO_SAFE_PART_BYTES) {
    return [
      {
        to: UI_BUNDLE_STORE_ADDRESS,
        data: bytesToHex(concatBytes(hashBytes, rawBytes)),
        label: `${labelName} (${(rawBytes.length / 1024).toFixed(1)}K)`,
      },
    ];
  }
  const parts = splitBundleIntoChunks(rawBytes, UI_BUNDLE_RADIO_SAFE_PART_BYTES);
  return parts.map((part, idx) => {
    const hdr = new Uint8Array([
      (idx >> 8) & 0xff,
      idx & 0xff,
      (parts.length >> 8) & 0xff,
      parts.length & 0xff,
    ]);
    return {
      to: UI_BUNDLE_STORE_ADDRESS,
      data: bytesToHex(concatBytes(UI_BUNDLE_MULTIPART_MAGIC, hashBytes, hdr, part)),
      label: `${labelName}[${idx + 1}/${parts.length}]`,
    };
  });
}

async function main() {
  const filterSlugs = new Set(
    process.argv
      .slice(2)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  execSync(`python3 ${path.join(WEB_ROOT, 'scripts/pack-app-bundles.py')}`, { stdio: 'inherit' });

  const deployManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(APP_MANIFEST_PATH, 'utf8'));
  const appStoreAddr = deployManifest.appStore;
  const storeClient = new AppStoreClient({ rpcUrl: PRIMARY_RPC, appStoreAddr });

  const targetApps = catalog.apps.filter((a) => filterSlugs.size === 0 || filterSlugs.has(a.slug));

  // 1. Collect unique missing media assets + UI bundles for `0x0101`
  const uniqueBlobs = new Map();
  for (const app of targetApps) {
    for (const asset of app.assets || []) {
      if (!uniqueBlobs.has(asset.hash.toLowerCase())) {
        const diskPath = path.join(WEB_ROOT, 'public', asset.path.replace(/^\//, ''));
        const bytes = new Uint8Array(fs.readFileSync(diskPath));
        if (keccak256Hex(bytes).toLowerCase() !== asset.hash.toLowerCase()) {
          throw new Error(`Asset hash mismatch on ${asset.path}`);
        }
        uniqueBlobs.set(asset.hash.toLowerCase(), {
          kind: 'asset',
          label: path.basename(asset.path),
          hash: asset.hash.toLowerCase(),
          bytes,
        });
      }
    }
    const gzPath = path.join(WEB_ROOT, 'public', app.bundleUrl.replace(/^\//, ''));
    const gzBytes = new Uint8Array(fs.readFileSync(gzPath));
    uniqueBlobs.set(app.uiHash.toLowerCase(), {
      kind: 'ui',
      label: `${app.slug}.html.gz`,
      hash: app.uiHash.toLowerCase(),
      bytes: gzBytes,
    });
  }

  const blobItems = Array.from(uniqueBlobs.values());
  const existence = await Promise.all(
    blobItems.map((b) => slxNodeRpc(PRIMARY_RPC, 'slx_getUiBundle', [b.hash]).catch(() => null))
  );

  const pending0x0101Specs = [];
  let newAssetCount = 0;
  let newUiCount = 0;
  for (let i = 0; i < blobItems.length; i++) {
    const b = blobItems[i];
    const ex = existence[i];
    if (ex?.exists && ex.size === b.bytes.length) continue;
    if (b.kind === 'asset') newAssetCount += 1;
    else newUiCount += 1;
    pending0x0101Specs.push(...build0x0101TxSpecs(b.label, b.hash, b.bytes));
  }

  // Send `0x0101` tx parts in crisp radio-friendly batches of 6 parts per block!
  for (let off = 0; off < pending0x0101Specs.length; off += 6) {
    await sendOrderedBatch(pending0x0101Specs.slice(off, off + 6));
  }

  // 2. Check & update `AppStore` pointers
  const publishSpecs = [];
  for (const app of targetApps) {
    const onChain = await storeClient.fetchAppBySlug(app.slug).catch(() => null);
    const wantHfs = (app.defaultHfsAddr || ZERO_ADDR).toLowerCase();
    const wantWasm = (app.wasmCodeHash || ZERO_BYTES32).toLowerCase();
    const wantUi = app.uiHash.toLowerCase();

    const upToDate =
      onChain &&
      String(onChain.uiHash || '').toLowerCase() === wantUi &&
      String(onChain.defaultHfsAddr || ZERO_ADDR).toLowerCase() === wantHfs &&
      String(onChain.wasmCodeHash || ZERO_BYTES32).toLowerCase() === wantWasm &&
      String(onChain.version || '') === String(app.version || '');

    if (!upToDate) {
      publishSpecs.push({
        to: appStoreAddr,
        data: AppStoreAbi.publishApp({
          slugId: app.slugId,
          publisherIdentity: ZERO_ADDR,
          wasmCodeHash: wantWasm,
          defaultHfsAddr: wantHfs,
          uiHash: wantUi,
          category: app.category,
          execMode: app.execMode,
          title: app.title,
          summary: app.summary,
          icon: app.icon,
          version: app.version,
        }),
        gasLimit: 5_000_000n,
        extraTargets: wantHfs !== ZERO_ADDR ? [wantHfs] : [],
        label: `publishApp(${app.slug} v${app.version})`,
      });
    }
  }

  for (let off = 0; off < publishSpecs.length; off += 6) {
    await sendOrderedBatch(publishSpecs.slice(off, off + 6));
  }

  console.log(
    `\n✅ On-Chain Publish Complete: ${newAssetCount} media blobs + ${newUiCount} UI bundles uploaded to 0x0101, ${publishSpecs.length} AppStore entries updated!`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('PUBLISH ERROR:', err);
  process.exit(1);
});
