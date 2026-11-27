/**
 * Unified SuperLexicon Client Header (`src/client-header.js`).
 *
 * Mounts `mountSlxUnifiedHeader` (`@superlexicon/sdk/ui`) with the Multi-Subnet Selector,
 * live BFT telemetry bar, App Switcher, `👥 Network`, `💬 Messages`, and `🪪 Identity / Wallet` pills.
 * Supports optional `window.__SLX_HEADER_SPEC__` override when embedded in `superlexicon-slides`.
 */

import { SlxWalletManager, SlxHfsCache, getDefaultNodeWsUrl } from '@superlexicon/sdk';
import { mountSlxUnifiedHeader } from '@superlexicon/sdk/ui';
import { mountEmbeddedAppDirectory } from './embedded-app-directory.js';

export const slidesWallet = new SlxWalletManager();
if (typeof window !== 'undefined') {
  window.__slxSlidesWallet = slidesWallet;
}
let rpcUrl = getDefaultNodeWsUrl();

const spec = (typeof window !== 'undefined' && window.__SLX_HEADER_SPEC__) || {};
const mobileTocBtn =
  typeof document !== 'undefined' ? document.getElementById('mobileTocTriggerBtn') : null;

export const unifiedHdr = mountSlxUnifiedHeader({
  mountContainer:
    typeof document !== 'undefined' ? document.getElementById('slxUnifiedHeaderMount') : null,
  wallet: slidesWallet,
  activeAppId: spec.activeAppId || 'explorer',
  title: spec.title || 'SuperLexicon — Multi-Subnet HFS Client & Block Explorer',
  subtitle:
    spec.subtitle ||
    'Zero-Gas Haltproof WASM Subroutines • LR2021 RF & Encrypted TCP/IP Subnets • Self-Sovereign Identity',
  rpcUrlFn: () => rpcUrl,
  mobileElements: mobileTocBtn ? [mobileTocBtn] : [],
  onWalletSwitch: async () => {
    await slidesWallet.resolveVerifiedIdentity(rpcUrl).catch(() => null);
    unifiedHdr?.refresh?.();
  },
});

const embeddedDirEl =
  typeof document !== 'undefined' ? document.getElementById('slxEmbeddedAppDirectoryMount') : null;
const embeddedDir = embeddedDirEl
  ? mountEmbeddedAppDirectory(embeddedDirEl, { rpcUrlFn: () => rpcUrl })
  : null;

SlxHfsCache.hydrateWithManifest()
  .then(async ({ cache }) => {
    if (cache?.rpcUrl) rpcUrl = cache.rpcUrl;
    await slidesWallet.resolveVerifiedIdentity(rpcUrl).catch(() => null);
    unifiedHdr?.refresh?.();
    embeddedDir?.refresh?.();
  })
  .catch(() => {});
