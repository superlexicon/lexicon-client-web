/**
 * Universal HFS App Host Bootloader (`src/app-host-boot.js`)
 *
 * Boots ANY SuperLexicon HFS app from the single universal `/app.html` shell (including clean URL
 * routes like `/<slug>.html`, `/app/<slug>`, and `/app.html?app=<slug>`) with zero per-app HTML
 * entrypoints — resolving `uiHash`, `defaultHfsAddr`, `wasmCodeHash`, and `0x0101` media blobs
 * directly from Subnet 1 (`app_store.wasm` + `UI_BUNDLE_STORE`) with local `IndexedDB` caching.
 */

import {
  APP_EXEC_MODE,
  AppStoreClient,
  SlxPersonalAppContainer,
  SlxUiBundleCache,
  ZERO_BYTES32,
  getDefaultNodeWsUrl,
  shortHex,
} from '@superlexicon/sdk';
import {
  resolveFastCachedAppMeta,
  resolveEffectiveAppMeta,
  revalidateMountedAppInBackground,
  mountVerifiedHostAppBundle,
} from './app-host-runtime.js';

const RESERVED_SHELL_SLUGS = new Set(['index', 'apps', 'explorer', 'app']);

export function resolveRequestedAppSlug() {
  const fromAttr = document.body?.getAttribute('data-slx-app-slug') || '';
  if (fromAttr.trim()) return fromAttr.trim().toLowerCase();

  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('app') || params.get('slug') || '';
  if (fromQuery.trim()) return fromQuery.trim().toLowerCase();

  const fromId = params.get('id') || params.get('appId') || '';
  if (fromId.trim() && /^\d+$/.test(fromId.trim())) {
    return `app-${fromId.trim()}`;
  }

  const pathname = window.location.pathname || '';
  const appPrefixMatch = pathname.match(/^\/app\/([a-z0-9_-]+)\/?$/i);
  if (appPrefixMatch) {
    return appPrefixMatch[1].toLowerCase();
  }

  const htmlSlugMatch = pathname.match(/^\/([a-z0-9_-]+)\.html$/i);
  if (htmlSlugMatch) {
    const candidate = htmlSlugMatch[1].toLowerCase();
    if (!RESERVED_SHELL_SLUGS.has(candidate)) {
      return candidate;
    }
  }

  return '';
}

async function bootHostStub() {
  const slug = resolveRequestedAppSlug();
  if (!slug) {
    window.location.replace('/apps.html');
    return;
  }

  const storeClient = new AppStoreClient({ rpcUrl: getDefaultNodeWsUrl() });
  const pinnedInstalled = SlxPersonalAppContainer.getInstalled(slug);

  // 1. Query live on-chain `AppStore` first (bounded to 1200ms so offline/RF cached boot still works
  //    even if disconnected, while connected clients ALWAYS pick up new UI/WASM/HFS releases on Subnet 1
  //    immediately without ever redeploying the static web server!).
  let liveMeta = null;
  if (!pinnedInstalled) {
    try {
      liveMeta = await Promise.race([
        resolveEffectiveAppMeta(slug, storeClient),
        new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
    } catch (_) {}
  }

  // 2. Fast Path: If the resolved `uiHash` is already verified in local IndexedDB/CAS, mount immediately!
  try {
    const fastMeta = pinnedInstalled || liveMeta || resolveFastCachedAppMeta(slug);
    if (fastMeta && fastMeta.execMode === APP_EXEC_MODE.SANDBOX_IFRAME && !fastMeta.isSystemCore) {
      window.location.replace(`/apps.html?run=${encodeURIComponent(slug)}`);
      return;
    }
    if (fastMeta?.uiHash && fastMeta.uiHash !== ZERO_BYTES32) {
      const fastHtml = await SlxUiBundleCache.getVerifiedHtml(fastMeta.uiHash);
      if (fastHtml?.html) {
        await mountVerifiedHostAppBundle({
          appMeta: fastMeta,
          verifiedBundle: { ...fastHtml, cacheHit: true, loadedFrom: 'local-cache' },
          storeClient,
        });
        revalidateMountedAppInBackground(slug, fastMeta.uiHash, storeClient);
        return;
      }
    }
  } catch (_) {}

  // 3. Cold / Updated Bundle Path: Fetch, `keccak256`-verify & cache from `0x0101` (`UI_BUNDLE_STORE`)
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#050a14;color:#e2e8f0;font-family:'JetBrains Mono',monospace;">
      <div style="max-width:480px;width:100%;padding:20px 22px;border-radius:14px;border:1px solid rgba(56,189,248,0.4);background:rgba(8,17,34,0.95);text-align:center;">
        <div style="font-size:13px;font-weight:800;color:#7dd3fc;">🧩 Syncing Verified On-Chain App ("${slug}")…</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:6px;">Fetching UI &amp; media from Subnet 1 <code>0x0101</code>, verifying <code>keccak256</code> &amp; caching in <code>IndexedDB</code></div>
      </div>
    </div>
  `;

  try {
    const appMeta = pinnedInstalled || liveMeta || (await resolveEffectiveAppMeta(slug, storeClient));
    if (!appMeta) {
      throw new Error(`App "${slug}" was not found in AppStore HFS or genesis catalog.`);
    }
    if (appMeta.execMode === APP_EXEC_MODE.SANDBOX_IFRAME && !appMeta.isSystemCore) {
      window.location.replace(`/apps.html?run=${encodeURIComponent(slug)}`);
      return;
    }

    const verifiedBundle = await storeClient.fetchVerifiedBundleHtml({
      uiHash: appMeta.uiHash,
      fallbackBundleUrl: appMeta.bundleUrl || '',
      slug: appMeta.slug,
      title: appMeta.title,
    });

    await mountVerifiedHostAppBundle({ appMeta, verifiedBundle, storeClient });
    if (pinnedInstalled) {
      revalidateMountedAppInBackground(slug, appMeta.uiHash, storeClient);
    }
  } catch (err) {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#050a14;color:#fecdd3;font-family:'JetBrains Mono',monospace;">
        <div style="max-width:540px;width:100%;padding:22px;border-radius:14px;border:1px solid rgba(244,63,94,0.55);background:rgba(28,8,18,0.94);">
          <div style="font-size:14px;font-weight:800;color:#fda4af;">⚠ HFS App Bundle Verification / Load Error</div>
          <div style="font-size:12px;margin-top:8px;line-height:1.5;color:#ffe4e6;">${String(err.message || err).replace(/</g, '&lt;')}</div>
          <div style="margin-top:14px;display:flex;gap:10px;">
            <a href="/apps.html" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(56,189,248,0.6);background:rgba(14,165,233,0.2);color:#e0f2fe;text-decoration:none;font-size:12px;font-weight:700;">🏪 Open HFS App Store →</a>
            <button onclick="location.reload()" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(148,163,184,0.4);background:transparent;color:#cbd5e1;cursor:pointer;font-family:inherit;font-size:12px;">↻ Retry (${shortHex(slug)})</button>
          </div>
        </div>
      </div>
    `;
  }
}

bootHostStub();
