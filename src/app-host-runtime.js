/**
 * SuperLexicon Universal HFS App Host Shared Runtime (`src/app-host-runtime.js`)
 *
 * Bundled once by the static Host Shell so dynamically fetched & `keccak256`-verified HFS UI
 * bundles + `0x0101` media assets never require static web-server redeployments when apps,
 * artwork, manuals, or WASM contracts are published or upgraded on Subnet 1.
 */

import * as sdk from '@superlexicon/sdk';
import * as sdkUi from '@superlexicon/sdk/ui';
import * as sdkWebrtc from '@superlexicon/sdk/webrtc';
import * as rideExchange from '@superlexicon/sdk/ride-exchange';
import * as instSuite from '@superlexicon/sdk/inst-suite';
import * as hfsRegistry from '@superlexicon/sdk/hfs-deployers';
import * as ifrsValuation from '@superlexicon/sdk/ifrs-valuation';
import * as ifrsHumanGl from '@superlexicon/sdk/ifrs-human-gl';
import * as gameGuide from '@superlexicon/sdk/ui/game-guide';
import * as fleetSocial from '@superlexicon/sdk/fleet-social';
import * as legalConsent from '@superlexicon/sdk/ui/legal-consent';

const ONCHAIN_META_CACHE_KEY = 'slx_onchain_app_meta_v1';
const _blobUrlByAssetHash = new Map();
let _activeAssetObserver = null;

export const HOST_MODULE_MAP = Object.freeze({
  // Canonical @superlexicon/sdk submodule imports (used by all on-chain HFS UI bundles)
  '@superlexicon/sdk': sdk,
  '@superlexicon/sdk/ui': sdkUi,
  '@superlexicon/sdk/webrtc': sdkWebrtc,
  '@superlexicon/sdk/ride-exchange': rideExchange,
  '@superlexicon/sdk/inst-suite': instSuite,
  '@superlexicon/sdk/hfs-deployers': hfsRegistry,
  '@superlexicon/sdk/ifrs-valuation': ifrsValuation,
  '@superlexicon/sdk/ifrs-human-gl': ifrsHumanGl,
  '@superlexicon/sdk/ui/game-guide': gameGuide,
  '@superlexicon/sdk/fleet-social': fleetSocial,
  '@superlexicon/sdk/ui/legal-consent': legalConsent,
  // Backwards-compatible aliases for previously forked/cached bundles
  './slx-inst-suite.js': instSuite,
  '/src/slx-inst-suite.js': instSuite,
  './slx-hfs-registry.js': hfsRegistry,
  '/src/slx-hfs-registry.js': hfsRegistry,
  './ifrs-valuation.js': ifrsValuation,
  '/src/ifrs-valuation.js': ifrsValuation,
  './ifrs-human-gl.js': ifrsHumanGl,
  '/src/ifrs-human-gl.js': ifrsHumanGl,
  './game-guide.js': gameGuide,
  '/src/game-guide.js': gameGuide,
  './slx-fleet-social.js': fleetSocial,
  '/src/slx-fleet-social.js': fleetSocial,
  './legal-consent.js': legalConsent,
  '/src/legal-consent.js': legalConsent,
});

if (typeof globalThis !== 'undefined') {
  globalThis.__SLX_HOST_MODULES__ = HOST_MODULE_MAP;
}

function _loadCachedOnChainAppMap() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ONCHAIN_META_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function _saveCachedOnChainAppMeta(slug, meta) {
  if (typeof localStorage === 'undefined' || !slug || !meta?.uiHash) return;
  try {
    const map = _loadCachedOnChainAppMap();
    map[String(slug).toLowerCase()] = { ...meta, cachedAt: Date.now() };
    localStorage.setItem(ONCHAIN_META_CACHE_KEY, JSON.stringify(map));
  } catch (_) {}
}

/**
 * Rewrites static ES `import ... from '<hostSpecifier>'` statements inside a verified HFS UI
 * bundle's `<script type="module">` into `globalThis.__SLX_HOST_MODULES__[...]` bindings so the
 * bundle executes cleanly from an in-memory `blob:` ES module URL without build-time coupling.
 */
export function rewriteHostModuleImports(jsSource) {
  const staticImportRe =
    /^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;

  return String(jsSource || '').replace(staticImportRe, (fullMatch, clause, spec) => {
    const cleanSpec = String(spec || '').trim();
    if (!Object.prototype.hasOwnProperty.call(HOST_MODULE_MAP, cleanSpec)) {
      return fullMatch;
    }
    const modExpr = `globalThis.__SLX_HOST_MODULES__[${JSON.stringify(cleanSpec)}]`;
    const trimmedClause = clause
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .trim();

    const nsMatch = trimmedClause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (nsMatch) {
      return `const ${nsMatch[1]} = ${modExpr};`;
    }

    if (trimmedClause.startsWith('{') && trimmedClause.endsWith('}')) {
      const inner = trimmedClause.slice(1, -1);
      const bindings = inner
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const asMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          return asMatch ? `${asMatch[1]}: ${asMatch[2]}` : part;
        });
      return `const { ${bindings.join(', ')} } = ${modExpr};`;
    }

    const comboMatch = trimmedClause.match(/^([A-Za-z_$][\w$]*)\s*,\s*\{([\s\S]*)\}$/);
    if (comboMatch) {
      const defIdent = comboMatch[1];
      const bindings = comboMatch[2]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const asMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          return asMatch ? `${asMatch[1]}: ${asMatch[2]}` : part;
        });
      return `const ${defIdent} = ${modExpr}.default; const { ${bindings.join(', ')} } = ${modExpr};`;
    }

    if (/^[A-Za-z_$][\w$]*$/.test(trimmedClause)) {
      return `const ${trimmedClause} = ${modExpr}.default ?? ${modExpr};`;
    }

    return fullMatch;
  });
}

let _catalogPromise = null;
let _bgRevalidateInFlight = false;

async function _fetchManifestNetwork() {
  const resp = await fetch('/app-bundles/manifest.json', { cache: 'no-cache' });
  if (!resp.ok) return null;
  const json = await resp.json();
  if (json && Array.isArray(json.apps)) {
    sdk.cacheCatalogManifestLocal(json);
    sdk.SlxPersonalAppContainer.syncCatalogMetadata(json.apps);
    return json;
  }
  return null;
}

export async function loadGenesisAppCatalog({ forceNetwork = false } = {}) {
  if (!forceNetwork) {
    const localCached = sdk.getCachedCatalogManifestLocal();
    if (localCached && Array.isArray(localCached.apps) && localCached.apps.length > 0) {
      if (!_bgRevalidateInFlight) {
        _bgRevalidateInFlight = true;
        _fetchManifestNetwork()
          .then((fresh) => {
            if (fresh) _catalogPromise = Promise.resolve(fresh);
          })
          .catch(() => {})
          .finally(() => {
            _bgRevalidateInFlight = false;
          });
      }
      return localCached;
    }
  }
  if (_catalogPromise && !forceNetwork) return _catalogPromise;
  _catalogPromise = (async () => {
    try {
      const fresh = await _fetchManifestNetwork();
      return fresh || sdk.getCachedCatalogManifestLocal() || { apps: [] };
    } catch (_) {
      return sdk.getCachedCatalogManifestLocal() || { apps: [] };
    }
  })();
  return _catalogPromise;
}

/**
 * Synchronous (`0 ms`) local metadata lookup across:
 *   1. User's Personal App Container (`SlxPersonalAppContainer`)
 *   2. Cached live on-chain `AppStore` release (`slx_onchain_app_meta_v1`)
 *   3. Locally published Studio apps (`localStorage`)
 *   4. Cached Genesis catalog manifest (`localStorage`)
 */
export function resolveFastCachedAppMeta(slug) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!cleanSlug) return null;
  const cachedManifest = sdk.getCachedCatalogManifestLocal();
  const base =
    (cachedManifest?.apps || []).find((a) => String(a.slug || '').toLowerCase() === cleanSlug) ||
    null;
  const installed = sdk.SlxPersonalAppContainer.getInstalled(cleanSlug);
  if (installed) {
    const pinned = { ...(base || {}), ...installed };
    if (base && pinned.uiHash && base.uiHash && pinned.uiHash.toLowerCase() !== base.uiHash.toLowerCase()) {
      pinned.bundleUrl = '';
    }
    return pinned;
  }

  const cachedOnChain = _loadCachedOnChainAppMap()[cleanSlug] || null;
  const localOverrides = sdk
    .loadLocalPublishedApps()
    .find((a) => String(a.slug || '').toLowerCase() === cleanSlug);

  if (!base && !localOverrides && !cachedOnChain) return null;
  const merged = {
    ...(base || {}),
    ...(localOverrides || {}),
    ...(cachedOnChain || {}),
  };
  if (base && merged.uiHash && base.uiHash && merged.uiHash.toLowerCase() !== base.uiHash.toLowerCase()) {
    merged.bundleUrl = '';
  }
  return merged;
}

export async function revalidateMountedAppInBackground(slug, mountedUiHash, storeClient) {
  try {
    const latest = await resolveEffectiveAppMeta(slug, storeClient);
    if (!latest?.uiHash) return;

    if (sdk.SlxPersonalAppContainer.isInstalled(slug)) {
      sdk.SlxPersonalAppContainer.syncCatalogMetadata([latest]);
    }

    const cleanMounted = String(mountedUiHash || '').toLowerCase();
    const cleanLatest = String(latest.uiHash || '').toLowerCase();
    const pendingInstUpd = sdk.SlxPersonalAppContainer.getPendingUpdate(slug);
    const hasDiff =
      Boolean(pendingInstUpd) ||
      (cleanLatest && cleanLatest !== sdk.ZERO_BYTES32 && cleanLatest !== cleanMounted);
    if (!hasDiff) {
      return;
    }

    const pill = document.getElementById('slxBundleVerifiedPill');
    if (pill && !pill.querySelector('[data-slx-reload-update]')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-slx-reload-update', '1');
      btn.style.cssText =
        'padding:2px 8px;border-radius:999px;border:1px solid rgba(251,191,36,0.85);background:rgba(245,158,11,0.26);color:#fef3c7;font-family:inherit;font-size:10px;font-weight:800;cursor:pointer;';
      const scopeParts = [
        pendingInstUpd?.hasNewUi ?? cleanLatest !== cleanMounted ? 'UI' : '',
        pendingInstUpd?.hasNewWasm ? 'WASM' : '',
        pendingInstUpd?.hasNewHfsInstance ? 'HFS' : '',
      ].filter(Boolean);
      const scopeTag = scopeParts.length ? ` (${scopeParts.join('+')})` : '';
      btn.textContent = `🔄 Update to v${latest.version || 'New'}${scopeTag}`;
      btn.title = 'Click to verify, cache, and apply this update';
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = '⏳ Verifying Update…';
        try {
          if (sdk.SlxPersonalAppContainer.isInstalled(slug)) {
            await sdk.SlxPersonalAppContainer.updateApp(slug, {
              storeClient,
              latestMeta: latest,
            });
          } else if (storeClient) {
            await storeClient.fetchVerifiedBundleHtml({
              uiHash: latest.uiHash,
              fallbackBundleUrl: latest.bundleUrl || '',
              slug: latest.slug,
              title: latest.title,
            });
          }
          window.location.reload();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = `⚠ Retry Update`;
          btn.title = String(err.message || err);
        }
      };
      pill.appendChild(btn);
    }
  } catch (_) {}
}

/**
 * Resolves the latest metadata & `uiHash` for an app `slug`, always preferring live on-chain
 * `AppStore` state on Subnet 1 over any static genesis catalog file.
 */
export async function resolveEffectiveAppMeta(slug, storeClient) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  const [catalog, onChain] = await Promise.all([
    loadGenesisAppCatalog().catch(() => ({ apps: [] })),
    (async () => {
      if (!storeClient) return null;
      try {
        const idMatch = cleanSlug.match(/^app-(\d+)$/);
        if (idMatch && typeof storeClient.fetchAppById === 'function') {
          const byId = await storeClient.fetchAppById(Number(idMatch[1]));
          if (byId) return byId;
        }
        return await storeClient.fetchAppBySlug(cleanSlug);
      } catch (_) {
        return null;
      }
    })(),
  ]);

  const base = (catalog.apps || []).find((a) => a.slug === cleanSlug) || null;
  const localOverrides = sdk
    .loadLocalPublishedApps()
    .find((a) => String(a.slug || '').toLowerCase() === cleanSlug);

  if (!base && !localOverrides && !onChain) {
    return null;
  }

  const merged = {
    ...(base || {}),
    ...(localOverrides || {}),
    ...(onChain
      ? {
          slug: base?.slug || localOverrides?.slug || cleanSlug,
          appId: onChain.appId,
          title: onChain.title || localOverrides?.title || base?.title,
          summary: onChain.summary || localOverrides?.summary || base?.summary,
          icon: onChain.icon || localOverrides?.icon || base?.icon,
          version: onChain.version || localOverrides?.version || base?.version,
          category: onChain.category || localOverrides?.category || base?.category,
          execMode:
            base?.isSystemCore || onChain.execMode === sdk.APP_EXEC_MODE.VERIFIED_HOST
              ? sdk.APP_EXEC_MODE.VERIFIED_HOST
              : onChain.execMode,
          uiHash: onChain.uiHash,
          wasmCodeHash:
            onChain.wasmCodeHash !== sdk.ZERO_BYTES32
              ? onChain.wasmCodeHash
              : base?.wasmCodeHash || sdk.ZERO_BYTES32,
          defaultHfsAddr:
            onChain.defaultHfsAddr !== sdk.ZERO_ADDR
              ? onChain.defaultHfsAddr
              : base?.defaultHfsAddr || sdk.ZERO_ADDR,
          publisher: onChain.publisher,
          releaseCount: onChain.releaseCount,
          updatedBlock: onChain.updatedBlock,
          source: 'onchain',
        }
      : {}),
  };

  if (base && merged.uiHash && merged.uiHash.toLowerCase() !== base.uiHash.toLowerCase()) {
    merged.bundleUrl = '';
  }

  if (onChain?.uiHash && onChain.uiHash !== sdk.ZERO_BYTES32) {
    _saveCachedOnChainAppMeta(cleanSlug, merged);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Content-Addressed On-Chain Media / Artwork Loader (`0x0101` + `IndexedDB`)
// ---------------------------------------------------------------------------

function _replaceAssetPathsInText(text, sortedEntries) {
  let out = String(text || '');
  for (const [webPath, blobUrl] of sortedEntries) {
    if (out.includes(webPath)) {
      out = out.split(webPath).join(blobUrl);
    }
  }
  return out;
}

function _rewriteDomElementAssets(rootEl, sortedEntries, assetMap) {
  if (!rootEl || !sortedEntries.length) return;
  const applyNode = (el) => {
    if (!el || el.nodeType !== 1) return;
    for (const attr of ['src', 'href']) {
      const val = el.getAttribute(attr);
      if (val && assetMap.has(val)) {
        el.setAttribute(attr, assetMap.get(val));
      }
    }
    const st = el.getAttribute('style');
    if (st && st.includes('/assets/')) {
      const nextSt = _replaceAssetPathsInText(st, sortedEntries);
      if (nextSt !== st) el.setAttribute('style', nextSt);
    }
  };
  applyNode(rootEl);
  rootEl.querySelectorAll?.('img[src], image[href], [style*="/assets/"]').forEach(applyNode);
}

async function _hydrateBundleOnChainAssets(doc, storeClient) {
  const assetScript = doc.getElementById('slx-bundle-assets');
  if (!assetScript) {
    return { assetMap: new Map(), sortedEntries: [], total: 0, onChainLoads: 0, cacheHits: 0 };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(assetScript.textContent || '{}');
  } catch (_) {
    parsed = null;
  }
  assetScript.remove();
  if (!parsed || typeof parsed !== 'object') {
    return { assetMap: new Map(), sortedEntries: [], total: 0, onChainLoads: 0, cacheHits: 0 };
  }

  const entries = Object.entries(parsed);
  if (!entries.length) {
    return { assetMap: new Map(), sortedEntries: [], total: 0, onChainLoads: 0, cacheHits: 0 };
  }

  const effectiveClient =
    storeClient || new sdk.AppStoreClient({ rpcUrl: sdk.getDefaultNodeWsUrl() });
  const assetMap = new Map();
  let onChainLoads = 0;
  let cacheHits = 0;

  await Promise.all(
    entries.map(async ([webPath, spec]) => {
      const cleanHash = String(spec?.hash || '').trim().toLowerCase();
      const mime = spec?.mime || 'image/jpeg';
      if (!cleanHash || cleanHash === sdk.ZERO_BYTES32) return;

      const memo = _blobUrlByAssetHash.get(cleanHash);
      if (memo?.blobUrl) {
        assetMap.set(webPath, memo.blobUrl);
        cacheHits += 1;
        return;
      }

      try {
        const res = await effectiveClient.fetchVerifiedAssetBytes({
          assetHash: cleanHash,
          fallbackUrl: webPath,
        });
        const blobUrl = URL.createObjectURL(new Blob([res.bytes], { type: mime }));
        _blobUrlByAssetHash.set(cleanHash, { blobUrl, loadedFrom: res.loadedFrom });
        assetMap.set(webPath, blobUrl);
        if (res.cacheHit) cacheHits += 1;
        else if (res.loadedFrom === 'onchain-ui-bundle-store') onChainLoads += 1;
      } catch (_) {
        // Leave original webPath intact if offline & uncached
      }
    })
  );

  // Sort longest paths first so substring replacement never collides on prefixes
  const sortedEntries = Array.from(assetMap.entries()).sort((a, b) => b[0].length - a[0].length);
  return {
    assetMap,
    sortedEntries,
    total: assetMap.size,
    onChainLoads,
    cacheHits,
  };
}

/**
 * Mounts a `keccak256`-verified `VERIFIED_HOST` single-file HTML bundle directly into the current
 * document, hydrating all `#slx-bundle-assets` artwork from `0x0101` + `IndexedDB` and exposing
 * live `AppStore` `defaultHfsAddr` + `wasmCodeHash` via `globalThis.__SLX_MOUNTED_APP__`.
 */
export async function mountVerifiedHostAppBundle({ appMeta, verifiedBundle, storeClient = null }) {
  if (_activeAssetObserver) {
    _activeAssetObserver.disconnect();
    _activeAssetObserver = null;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__SLX_MOUNTED_APP__ = Object.freeze({ ...(appMeta || {}) });
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(verifiedBundle.html, 'text/html');

  // Hydrate content-addressed artwork/media from IndexedDB (`< 2 ms`) or `0x0101` (`slx_getUiBundle`)
  const assetHydration = await _hydrateBundleOnChainAssets(doc, storeClient);
  const { assetMap, sortedEntries } = assetHydration;

  if (typeof globalThis !== 'undefined') {
    globalThis.__SLX_RESOLVE_ASSET__ = (p) => assetMap.get(String(p || '')) || p;
  }

  if (doc.title) {
    document.title = doc.title;
  }

  // Inject <style> blocks from the bundle into <head> (with `/assets/...` rewritten to `blob:` URLs)
  doc.head.querySelectorAll('style').forEach((styleEl) => {
    const clone = document.createElement('style');
    clone.setAttribute('data-slx-mounted-bundle', appMeta.slug || 'app');
    clone.textContent = sortedEntries.length
      ? _replaceAssetPathsInText(styleEl.textContent, sortedEntries)
      : styleEl.textContent;
    document.head.appendChild(clone);
  });

  // Extract <script> tags before injecting body markup
  const scripts = [];
  doc.body.querySelectorAll('script').forEach((scr) => {
    scripts.push({
      type: (scr.getAttribute('type') || '').toLowerCase(),
      code: scr.textContent || '',
    });
    scr.remove();
  });

  // Rewrite any static `<img src="/assets/...">` inside `doc.body` BEFORE touching live `document.body`
  if (sortedEntries.length) {
    _rewriteDomElementAssets(doc.body, sortedEntries, assetMap);
  }

  document.body.removeAttribute('style');
  if (doc.body.className) {
    document.body.className = doc.body.className;
  }
  if (doc.body.getAttribute('style')) {
    document.body.setAttribute('style', doc.body.getAttribute('style'));
  }
  document.body.innerHTML = doc.body.innerHTML;

  // Observe dynamic DOM mutations so runtime `innerHTML` templates using `/assets/...` also swap to `blob:` URLs!
  if (sortedEntries.length && typeof MutationObserver !== 'undefined') {
    _activeAssetObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          _rewriteDomElementAssets(m.target, sortedEntries, assetMap);
        } else if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === 1) _rewriteDomElementAssets(n, sortedEntries, assetMap);
          });
        }
      }
    });
    _activeAssetObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'style'],
    });
  }

  try {
    legalConsent.mountLegalConsent();
  } catch (_) {}

  mountVerifiedBundleBadge({ appMeta, verifiedBundle, assetHydration });

  for (const s of scripts) {
    if (!s.code.trim()) continue;
    const withAssets = sortedEntries.length
      ? _replaceAssetPathsInText(s.code, sortedEntries)
      : s.code;
    if (s.type === 'module') {
      const rewritten = rewriteHostModuleImports(withAssets);
      const blob = new Blob([rewritten], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        await import(/* @vite-ignore */ blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } else {
      const el = document.createElement('script');
      el.textContent = withAssets;
      document.body.appendChild(el);
    }
  }
}

function mountVerifiedBundleBadge({ appMeta, verifiedBundle, assetHydration }) {
  if (document.getElementById('slxBundleVerifiedPill')) return;
  const gzKb = ((verifiedBundle.compressedLen || appMeta.compressedLen || 0) / 1024).toFixed(1);
  const srcTag = verifiedBundle.cacheHit
    ? '⚡ Local Cache'
    : verifiedBundle.loadedFrom === 'onchain-ui-bundle-store'
    ? '⛓️ On-Chain UI Store'
    : 'Verified CAS';
  const shortUi = sdk.shortHex(verifiedBundle.uiHash || appMeta.uiHash || '', 8, 6);
  const mediaBadge =
    assetHydration?.total > 0
      ? `<span style="color:#64748b;">•</span><span style="color:#f0abfc;" title="${assetHydration.total} content-addressed media blobs verified from 0x0101 / IndexedDB">🎨 ${assetHydration.total} Media</span>`
      : '';

  const wrap = document.createElement('div');
  wrap.id = 'slxBundleVerifiedPill';
  wrap.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:9940;display:inline-flex;align-items:center;gap:7px;' +
    'padding:5px 10px;border-radius:999px;background:rgba(5,12,26,0.92);' +
    'border:1px solid rgba(56,189,248,0.42);backdrop-filter:blur(8px);' +
    'font-family:"JetBrains Mono",monospace;font-size:10.5px;color:#cbd5e1;box-shadow:0 8px 24px rgba(0,0,0,0.5);';

  const paintInstallBtn = (btn) => {
    const inst = sdk.SlxPersonalAppContainer.isInstalled(appMeta.slug);
    btn.textContent = inst ? '✓ Installed' : '⬇ Install';
    btn.title = inst
      ? 'Pinned in your Personal App Container & cached locally (click to uninstall)'
      : 'Install into your Personal App Container & pin HTML in local cache';
    btn.style.cssText = inst
      ? 'padding:1px 7px;border-radius:999px;border:1px solid rgba(52,211,153,0.65);background:rgba(16,185,129,0.22);color:#6ee7b7;font-family:inherit;font-size:10px;font-weight:800;cursor:pointer;'
      : 'padding:1px 7px;border-radius:999px;border:1px solid rgba(56,189,248,0.55);background:rgba(14,165,233,0.18);color:#e0f2fe;font-family:inherit;font-size:10px;font-weight:800;cursor:pointer;';
  };

  wrap.innerHTML =
    `<span style="color:#6ee7b7;font-weight:800;" title="keccak256(gzipBundle) verified before DOM execution">🧩 UI ${shortUi}</span>` +
    `<span style="color:#64748b;">•</span>` +
    `<span style="color:#93c5fd;">${gzKb}KB gz (${srcTag})</span>` +
    mediaBadge +
    `<button type="button" data-slx-pill-install="1"></button>` +
    `<a href="/apps.html?edit=${encodeURIComponent(appMeta.slug || '')}" style="color:#fde68a;text-decoration:none;font-weight:700;margin-left:2px;" title="Inspect, fork, or hot-publish a new UI version in the HFS App Store without redeploying the web client">✏ Studio</a>` +
    `<a href="/apps.html" style="color:#38bdf8;text-decoration:none;font-weight:700;" title="Open SuperLexicon HFS App Store Directory">🏪 Directory</a>`;

  const instBtn = wrap.querySelector('[data-slx-pill-install]');
  if (instBtn && appMeta.slug) {
    paintInstallBtn(instBtn);
    instBtn.addEventListener('click', async () => {
      if (sdk.SlxPersonalAppContainer.isInstalled(appMeta.slug)) {
        await sdk.SlxPersonalAppContainer.uninstallApp(appMeta.slug);
      } else {
        await sdk.SlxPersonalAppContainer.installApp(
          {
            ...appMeta,
            uiHash: verifiedBundle.uiHash || appMeta.uiHash,
            compressedLen: verifiedBundle.compressedLen || appMeta.compressedLen,
            uncompressedLen: verifiedBundle.uncompressedLen || appMeta.uncompressedLen,
          },
          { cacheHtml: false }
        );
      }
      paintInstallBtn(instBtn);
    });
    sdk.SlxPersonalAppContainer.onChange(() => paintInstallBtn(instBtn));
  }
  document.body.appendChild(wrap);
}
