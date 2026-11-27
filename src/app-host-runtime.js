/**
 * SuperLexicon Universal HFS App Host Shared Runtime (`src/app-host-runtime.js`)
 *
 * Bundled once by the static Host Shell so dynamically fetched & `keccak256`-verified HFS UI
 * bundles (`app_store.wasm` / `IndexedDB` CAS / `.html.gz`) never duplicate cryptographic, RLP,
 * WebSocket JSON-RPC, Unified Header, or IFRS/Governance libraries across apps.
 */

import * as sdk from '@superlexicon/sdk';
import * as sdkUi from '@superlexicon/sdk/ui';
import * as sdkWebrtc from '@superlexicon/sdk/webrtc';
import * as instSuite from '@superlexicon/sdk/inst-suite';
import * as hfsRegistry from '@superlexicon/sdk/hfs-deployers';
import * as ifrsValuation from '@superlexicon/sdk/ifrs-valuation';
import * as ifrsHumanGl from '@superlexicon/sdk/ifrs-human-gl';
import * as gameGuide from '@superlexicon/sdk/ui/game-guide';
import * as fleetSocial from '@superlexicon/sdk/fleet-social';
import * as legalConsent from '@superlexicon/sdk/ui/legal-consent';

export const HOST_MODULE_MAP = Object.freeze({
  // Canonical @superlexicon/sdk submodule imports (used by all on-chain HFS UI bundles)
  '@superlexicon/sdk': sdk,
  '@superlexicon/sdk/ui': sdkUi,
  '@superlexicon/sdk/webrtc': sdkWebrtc,
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

    // Form 1: `import * as ns from '...'`
    const nsMatch = trimmedClause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (nsMatch) {
      return `const ${nsMatch[1]} = ${modExpr};`;
    }

    // Form 2: `import { a, b as c } from '...'`
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

    // Form 3: `import defName, { a, b as c } from '...'`
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

    // Form 4: `import defName from '...'`
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
 *   1. Locally published Studio apps (`localStorage`)
 *   2. User's Personal App Container (`SlxPersonalAppContainer`)
 *   3. Cached Genesis catalog manifest (`localStorage`)
 * Enables `< 5 ms` instant boot from `SlxUiBundleCache` (`IndexedDB`) with zero network blocking.
 */
export function resolveFastCachedAppMeta(slug) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!cleanSlug) return null;
  const cachedManifest = sdk.getCachedCatalogManifestLocal();
  const base =
    (cachedManifest?.apps || []).find((a) => String(a.slug || '').toLowerCase() === cleanSlug) ||
    null;
  const installed = sdk.SlxPersonalAppContainer.getInstalled(cleanSlug);
  const localOverrides = sdk
    .loadLocalPublishedApps()
    .find((a) => String(a.slug || '').toLowerCase() === cleanSlug);

  if (!base && !installed && !localOverrides) return null;
  const merged = {
    ...(base || {}),
    ...(installed || {}),
    ...(localOverrides || {}),
  };
  if (base && merged.uiHash && base.uiHash && merged.uiHash.toLowerCase() !== base.uiHash.toLowerCase()) {
    merged.bundleUrl = '';
  }
  return merged;
}

/**
 * Background stale-while-revalidate check after an app boots from local HTML cache.
 * If a newer `uiHash` was published on-chain or in `/app-bundles/manifest.json`, pre-fetches and
 * caches the new verified HTML in the background and surfaces a 1-click reload prompt.
 */
export async function revalidateMountedAppInBackground(slug, mountedUiHash, storeClient) {
  try {
    await loadGenesisAppCatalog({ forceNetwork: true });
    const latest = await resolveEffectiveAppMeta(slug, storeClient);
    if (!latest?.uiHash) return;
    const cleanMounted = String(mountedUiHash || '').toLowerCase();
    const cleanLatest = String(latest.uiHash || '').toLowerCase();
    if (!cleanLatest || cleanLatest === sdk.ZERO_BYTES32 || cleanLatest === cleanMounted) {
      return;
    }
    if (storeClient) {
      await storeClient.fetchVerifiedBundleHtml({
        uiHash: latest.uiHash,
        fallbackBundleUrl: latest.bundleUrl || '',
        slug: latest.slug,
        title: latest.title,
      });
    }
    if (sdk.SlxPersonalAppContainer.isInstalled(slug)) {
      await sdk.SlxPersonalAppContainer.installApp(latest, { storeClient, cacheHtml: false });
    }
    const pill = document.getElementById('slxBundleVerifiedPill');
    if (pill && !pill.querySelector('[data-slx-reload-update]')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-slx-reload-update', '1');
      btn.style.cssText =
        'padding:2px 7px;border-radius:999px;border:1px solid rgba(52,211,153,0.75);background:rgba(16,185,129,0.28);color:#ecfdf5;font-family:inherit;font-size:10px;font-weight:800;cursor:pointer;';
      btn.textContent = `🔄 Update v${latest.version || 'New'} Cached — Reload`;
      btn.onclick = () => window.location.reload();
      pill.appendChild(btn);
    }
  } catch (_) {}
}

/**
 * Resolves the latest metadata & `uiHash` for an app `slug` by merging:
 *   1. Genesis catalog (`/app-bundles/manifest.json`)
 *   2. Locally published / updated Studio apps (`localStorage`)
 *   3. Live on-chain `AppStore` HFS (`getAppBySlug`) if deployed on Subnet 1!
 */
export async function resolveEffectiveAppMeta(slug, storeClient) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  const catalog = await loadGenesisAppCatalog();
  const base = (catalog.apps || []).find((a) => a.slug === cleanSlug) || null;
  const localOverrides = sdk
    .loadLocalPublishedApps()
    .find((a) => String(a.slug || '').toLowerCase() === cleanSlug);

  let onChain = null;
  if (storeClient) {
    try {
      onChain = await storeClient.fetchAppBySlug(cleanSlug);
    } catch (_) {}
  }

  if (!base && !localOverrides && !onChain) {
    return null;
  }

  // Prefer live on-chain `AppStore` release if present, then local Studio override, then genesis!
  const merged = {
    ...(base || {}),
    ...(localOverrides || {}),
    ...(onChain
      ? {
          appId: onChain.appId,
          title: onChain.title || localOverrides?.title || base?.title,
          summary: onChain.summary || localOverrides?.summary || base?.summary,
          icon: onChain.icon || localOverrides?.icon || base?.icon,
          version: onChain.version || localOverrides?.version || base?.version,
          category: onChain.category || localOverrides?.category || base?.category,
          execMode: base?.isSystemCore ? sdk.APP_EXEC_MODE.VERIFIED_HOST : onChain.execMode,
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

  // Only keep static genesis `bundleUrl` fallback if `uiHash` still matches genesis `base.uiHash`
  if (base && merged.uiHash && merged.uiHash.toLowerCase() !== base.uiHash.toLowerCase()) {
    merged.bundleUrl = '';
  }

  return merged;
}

/**
 * Mounts a `keccak256`-verified `VERIFIED_HOST` single-file HTML bundle directly into the current
 * document so URL query/hash deep-links, `localStorage` wallet state, WebSocket JSON-RPC, and DOM
 * styling run with 100% native fidelity, plus a compact non-intrusive Verified Bundle Inspector pill.
 */
export async function mountVerifiedHostAppBundle({ appMeta, verifiedBundle }) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(verifiedBundle.html, 'text/html');

  if (doc.title) {
    document.title = doc.title;
  }

  // Inject <style> blocks from the bundle into <head>
  doc.head.querySelectorAll('style').forEach((styleEl) => {
    const clone = document.createElement('style');
    clone.setAttribute('data-slx-mounted-bundle', appMeta.slug || 'app');
    clone.textContent = styleEl.textContent;
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

  // Reset inline stub styles on <body> so the app's own CSS rules govern <body> cleanly
  document.body.removeAttribute('style');
  if (doc.body.className) {
    document.body.className = doc.body.className;
  }
  if (doc.body.getAttribute('style')) {
    document.body.setAttribute('style', doc.body.getAttribute('style'));
  }
  document.body.innerHTML = doc.body.innerHTML;

  // Mount site-wide legal consent footer & modal
  try {
    legalConsent.mountLegalConsent();
  } catch (_) {}

  // Append compact, collapsible Verified HFS Bundle Inspector Pill (bottom-left)
  mountVerifiedBundleBadge({ appMeta, verifiedBundle });

  // Execute extracted module / inline scripts via Blob ES module URLs
  for (const s of scripts) {
    if (!s.code.trim()) continue;
    if (s.type === 'module') {
      const rewritten = rewriteHostModuleImports(s.code);
      const blob = new Blob([rewritten], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        await import(/* @vite-ignore */ blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } else {
      const el = document.createElement('script');
      el.textContent = s.code;
      document.body.appendChild(el);
    }
  }
}

function mountVerifiedBundleBadge({ appMeta, verifiedBundle }) {
  if (document.getElementById('slxBundleVerifiedPill')) return;
  const gzKb = ((verifiedBundle.compressedLen || appMeta.compressedLen || 0) / 1024).toFixed(1);
  const srcTag = verifiedBundle.cacheHit
    ? '⚡ Local Cache'
    : verifiedBundle.loadedFrom === 'onchain-appstore'
    ? '⛓️ On-Chain AppStore'
    : 'Verified CAS';
  const shortUi = sdk.shortHex(verifiedBundle.uiHash || appMeta.uiHash || '', 8, 6);

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
