/**
 * Reusable Embedded Categorized App Directory & Personal App Container (`src/embedded-app-directory.js`)
 *
 * Mounted on:
 *  - Slide 5 of `superlexicon-slides` (`#slxEmbeddedAppDirectoryMount[data-mode="slide5"]`)
 *  - Root Launchpad of `lexicon-client-web` (`#slxEmbeddedAppDirectoryMount[data-mode="hub"]`)
 *
 * Hydrates live from `/app-bundles/manifest.json` + local Studio overrides + Subnet 1 `AppStore` HFS,
 * groups all use cases cleanly by `APP_CATEGORIES` so user-submitted apps scale sustainably, and lets
 * users `⬇ Install` apps into their `SlxPersonalAppContainer` (pinning verified HTML in local cache).
 */

import {
  APP_CATEGORIES,
  APP_EXEC_MODE,
  ZERO_ADDR,
  ZERO_BYTES32,
  shortHex,
  getDefaultNodeWsUrl,
  AppStoreClient,
  SlxUiBundleCache,
  SlxPersonalAppContainer,
  loadLocalPublishedApps,
  cacheCatalogManifestLocal,
  getCachedCatalogManifestLocal,
} from '@superlexicon/sdk';
import { openSlxUseCaseDescription, USECASE_DESCRIPTIONS } from '@superlexicon/sdk/ui';

const WASM_LABELS_BY_SLUG = {
  accounting: 'accounting_ledger.wasm + confidential_ledger.wasm',
  charter: 'corporate_charter.wasm + share_capital.wasm',
  dex: 'dex_clob.wasm + asset_ledger.wasm',
  commerce: 'product_ledger.wasm + accounting_ledger.wasm',
  crowdfunding: 'crowdfunding.wasm + accounting_ledger.wasm',
  rewards: 'reward_voucher.wasm',
  ballot: 'secret_ballot.wasm',
  social: 'social_charter.wasm + messaging.wasm',
  telephony: 'webrtc_signal.wasm + identity.wasm',
  battleship: 'battleship.wasm',
  'cipher-noir': 'cipher_noir.wasm',
  hegemony: 'hegemony.wasm',
  lottery: 'lottery.wasm + vrf_beacon.wasm',
};

const EMBEDDED_DIR_CSS = `
.slx-ed-shell{border-radius:16px;border:1.5px solid rgba(56,189,248,.42);background:linear-gradient(180deg,rgba(7,15,30,.96) 0%,rgba(5,10,22,.97) 100%);overflow:hidden;color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif;box-shadow:0 16px 42px rgba(2,6,23,.48)}
.slx-ed-mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
.slx-ed-top{padding:14px 18px;border-bottom:1px solid rgba(51,65,85,.78);background:linear-gradient(90deg,rgba(6,38,34,.55) 0%,rgba(8,18,36,.92) 52%,rgba(10,26,48,.65) 100%);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.slx-ed-dock{padding:10px 18px;border-bottom:1px solid rgba(51,65,85,.68);background:rgba(4,10,22,.82);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.slx-ed-dock-list{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.slx-ed-dock-item{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:8px;border:1px solid rgba(52,211,153,.48);background:rgba(16,185,129,.12);color:#ecfdf5;font-size:.73rem;font-weight:700;text-decoration:none;transition:all .13s ease}
.slx-ed-dock-item:hover{border-color:#6ee7b7;background:rgba(16,185,129,.22)}
.slx-ed-bar{padding:11px 18px;border-bottom:1px solid rgba(51,65,85,.65);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:rgba(7,14,28,.9)}
.slx-ed-cats{display:flex;flex-wrap:wrap;gap:6px}
.slx-ed-cat{padding:5px 11px;border-radius:999px;border:1px solid rgba(71,85,105,.78);background:#060e1e;color:#cbd5e1;font-size:.7rem;font-weight:700;cursor:pointer;transition:all .13s ease}
.slx-ed-cat:hover{border-color:rgba(56,189,248,.6);color:#fff}
.slx-ed-cat.active{border-color:rgba(52,211,153,.8);background:rgba(16,185,129,.22);color:#d1fae5}
.slx-ed-search{padding:6px 11px;border-radius:8px;border:1px solid rgba(71,85,105,.85);background:#030813;color:#f8fafc;font-size:.73rem;min-width:225px;outline:none}
.slx-ed-search:focus{border-color:#38bdf8}
.slx-ed-body{padding:15px 18px;display:flex;flex-direction:column;gap:16px}
.slx-ed-body.slide-scroll{max-height:590px;overflow-y:auto}
.slx-ed-sec{display:flex;flex-direction:column;gap:9px}
.slx-ed-sec-hdr{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 11px;border-radius:9px;background:rgba(12,23,44,.88);border:1px solid rgba(56,189,248,.26);border-left:3.5px solid #38bdf8}
.slx-ed-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:11px}
.slx-ed-card{border-radius:12px;border:1px solid rgba(51,65,85,.88);background:rgba(9,17,34,.94);padding:13px 14px;display:flex;flex-direction:column;justify-content:space-between;gap:10px;transition:border-color .14s ease,transform .13s ease}
.slx-ed-card:hover{border-color:rgba(56,189,248,.68);transform:translateY(-1px)}
.slx-ed-card.installed{border-color:rgba(52,211,153,.52)}
.slx-ed-btn{padding:6px 10px;border-radius:8px;border:1px solid rgba(56,189,248,.52);background:rgba(14,165,233,.16);color:#e0f2fe;font-size:.69rem;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:all .14s ease;white-space:nowrap}
.slx-ed-btn:hover:not(:disabled){background:rgba(14,165,233,.3)}
.slx-ed-btn:disabled{opacity:.5;cursor:not-allowed}
.slx-ed-btn-em{border-color:rgba(52,211,153,.72);background:rgba(16,185,129,.22);color:#d1fae5}
.slx-ed-btn-em:hover:not(:disabled){background:rgba(16,185,129,.36)}
.slx-ed-btn-vi{border-color:rgba(167,139,250,.55);background:rgba(139,92,246,.18);color:#ede9fe}
@media(max-width:640px){.slx-ed-top,.slx-ed-dock,.slx-ed-bar,.slx-ed-body{padding:11px 12px}.slx-ed-search{width:100%;min-width:0}.slx-ed-grid{grid-template-columns:1fr}}
`;

function injectEmbeddedDirStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('slx-emb-dir-styles')) return;
  const st = document.createElement('style');
  st.id = 'slx-emb-dir-styles';
  st.textContent = EMBEDDED_DIR_CSS;
  document.head.appendChild(st);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function mountEmbeddedAppDirectory(
  hostEl,
  { rpcUrlFn = () => getDefaultNodeWsUrl() } = {}
) {
  if (!hostEl || typeof document === 'undefined') return null;
  injectEmbeddedDirStyles();

  const mode = hostEl.getAttribute('data-mode') || 'hub';
  const isSlideMode = mode === 'slide5';
  const storeClient = new AppStoreClient({ rpcUrl: rpcUrlFn() });

  const state = {
    apps: getCachedCatalogManifestLocal()?.apps || [],
    selectedCat: 0, // 0 = All Categorized, -1 = My Installed Apps, 1..6 = APP_CATEGORIES
    query: '',
    installingSlugs: new Set(),
    toastMsg: '',
  };

  hostEl.innerHTML = `
    <div class="slx-ed-shell">
      <div class="slx-ed-top">
        <div style="display:flex;flex-direction:column;gap:3px;max-width:760px;">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;">
            <span class="slx-ed-mono" style="padding:2px 8px;border-radius:6px;background:#34d399;color:#020617;font-size:.64rem;font-weight:900;text-transform:uppercase;">Zero Backend • Zero DB • Zero EC2</span>
            <strong style="font-size:.94rem;color:#f8fafc;">Categorized HFS App Store Directory &amp; Personal App Container (<code class="slx-ed-mono" style="font-size:.78rem;color:#6ee7b7;">app_store.wasm</code>)</strong>
          </div>
          <div style="font-size:.75rem;color:#cbd5e1;line-height:1.45;">
            Every SuperLexicon &amp; community-submitted use case runs as a <code class="slx-ed-mono">gzip</code>ped, <code class="slx-ed-mono">keccak256</code>-verified HTML bundle alongside its Halt-Free Subroutine. Click <strong>⬇ Install</strong> to pin apps into your Personal Container &amp; cache their HTML locally for instant loads.
          </div>
        </div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;">
          <span data-ed="cachePill" class="slx-ed-mono" style="padding:5px 9px;border-radius:8px;background:rgba(15,23,42,.9);border:1px solid rgba(56,189,248,.38);font-size:.67rem;color:#7dd3fc;">⚡ 0 cached</span>
          <a href="/apps.html" class="slx-ed-btn slx-ed-mono">🏪 Full App Store →</a>
          <a href="/apps.html?create=1" class="slx-ed-btn slx-ed-btn-em slx-ed-mono">➕ Publish App →</a>
          <button type="button" data-ed="archBtn" class="slx-ed-btn slx-ed-btn-vi slx-ed-mono">🏛️ Spec</button>
        </div>
      </div>

      <div class="slx-ed-dock" data-ed="dock"></div>

      <div class="slx-ed-bar">
        <div class="slx-ed-cats" data-ed="cats"></div>
        <input type="search" class="slx-ed-search slx-ed-mono" data-ed="search" placeholder="🔍 Filter use cases, category, .wasm…" />
      </div>

      <div class="slx-ed-body ${isSlideMode ? 'slide-scroll' : ''}" data-ed="body"></div>
    </div>
  `;

  const refs = {
    cachePill: hostEl.querySelector('[data-ed="cachePill"]'),
    archBtn: hostEl.querySelector('[data-ed="archBtn"]'),
    dock: hostEl.querySelector('[data-ed="dock"]'),
    cats: hostEl.querySelector('[data-ed="cats"]'),
    search: hostEl.querySelector('[data-ed="search"]'),
    body: hostEl.querySelector('[data-ed="body"]'),
  };

  const renderCard = (a) => {
    const cat = APP_CATEGORIES[a.category] || APP_CATEGORIES[6];
    const isInstalled = SlxPersonalAppContainer.isInstalled(a.slug);
    const isCached = SlxUiBundleCache.isCachedSync(a.uiHash);
    const isInstalling = state.installingSlugs.has(a.slug);
    const gzKb = a.compressedLen ? `${(a.compressedLen / 1024).toFixed(1)} KiB gz` : 'CAS';
    const wasmLabel =
      WASM_LABELS_BY_SLUG[a.slug] ||
      (a.wasmCodeHash && a.wasmCodeHash !== ZERO_BYTES32
        ? `HFS ${shortHex(a.wasmCodeHash, 6, 4)}`
        : 'window.slx Host State');
    const href =
      a.route ||
      (a.execMode === APP_EXEC_MODE.VERIFIED_HOST || a.isSystemCore
        ? `/${a.slug}.html`
        : `/apps.html?run=${encodeURIComponent(a.slug)}`);
    const hasDoc = Boolean(USECASE_DESCRIPTIONS[a.slug]);

    return `
      <article class="slx-ed-card ${isInstalled ? 'installed' : ''}">
        <div style="display:flex;flex-direction:column;gap:7px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div style="display:flex;align-items:center;gap:9px;min-width:0;">
              <span style="width:34px;height:34px;border-radius:9px;background:rgba(14,165,233,.14);border:1px solid rgba(56,189,248,.34);display:inline-flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">${esc(a.icon || '🧩')}</span>
              <div style="min-width:0;">
                <div style="font-size:.84rem;font-weight:800;color:#f8fafc;line-height:1.22;">${esc(a.title)}</div>
                <div class="slx-ed-mono" style="font-size:.63rem;color:#94a3b8;margin-top:1px;">${cat.icon} ${esc(cat.shortLabel || cat.label)} • v${esc(a.version || '1.0')}</div>
              </div>
            </div>
            <span class="slx-ed-mono" style="padding:2px 7px;border-radius:999px;font-size:.6rem;font-weight:800;flex-shrink:0;${
              isCached
                ? 'background:rgba(16,185,129,.18);border:1px solid rgba(52,211,153,.5);color:#6ee7b7;'
                : 'background:rgba(14,165,233,.15);border:1px solid rgba(56,189,248,.4);color:#7dd3fc;'
            }">${isCached ? '⚡ Cached' : 'Zero-EC2'}</span>
          </div>
          <div style="font-size:.72rem;color:#cbd5e1;line-height:1.42;">${esc(a.summary || '')}</div>
          <div class="slx-ed-mono" style="font-size:.62rem;color:#94a3b8;padding:5px 8px;border-radius:7px;background:#030711;border:1px solid rgba(51,65,85,.65);display:flex;justify-content:space-between;gap:6px;overflow:hidden;">
            <span style="color:#7dd3fc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">⚙️ ${esc(wasmLabel)}</span>
            <span style="color:#6ee7b7;flex-shrink:0;">${esc(gzKb)}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <a href="${esc(href)}" class="slx-ed-btn slx-ed-btn-em slx-ed-mono" style="flex:1;">▶ Open${isCached ? ' ⚡' : ''}</a>
          ${
            isInstalling
              ? `<button type="button" class="slx-ed-btn slx-ed-mono" disabled>⏳ Caching…</button>`
              : isInstalled
              ? `<button type="button" class="slx-ed-btn slx-ed-mono" style="border-color:rgba(52,211,153,.65);color:#6ee7b7;" data-ed-uninstall="${esc(a.slug)}" title="Installed in Personal App Container &amp; cached locally (click to remove)">✓ Installed</button>`
              : `<button type="button" class="slx-ed-btn slx-ed-mono" data-ed-install="${esc(a.slug)}" title="Install into your Personal App Container &amp; cache HTML locally">⬇ Install</button>`
          }
          ${
            hasDoc
              ? `<button type="button" class="slx-ed-btn slx-ed-btn-vi slx-ed-mono" data-ed-doc="${esc(a.slug)}" title="Architecture &amp; HFS Spec">🏛️ Spec</button>`
              : ''
          }
        </div>
      </article>
    `;
  };

  const renderAll = () => {
    const installed = SlxPersonalAppContainer.listInstalled();
    const cacheStats = SlxUiBundleCache.getCacheStats();
    const gzKb = (cacheStats.totalCompressedBytes / 1024).toFixed(1);

    if (refs.cachePill) {
      refs.cachePill.textContent = `⚡ ${cacheStats.count} cached (${gzKb} KiB)`;
      refs.cachePill.title = `${cacheStats.count} verified HTML UI bundle(s) cached locally in IndexedDB/CacheStorage`;
    }

    // Personal App Container Dock
    if (refs.dock) {
      if (installed.length > 0) {
        refs.dock.innerHTML = `
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;">
            <span class="slx-ed-mono" style="font-size:.69rem;font-weight:800;color:#6ee7b7;">📦 My App Container (${installed.length}):</span>
            <div class="slx-ed-dock-list">
              ${installed
                .map((app) => {
                  const href =
                    app.route ||
                    (app.isSystemCore ? `/${app.slug}.html` : `/apps.html?run=${encodeURIComponent(app.slug)}`);
                  const cached = SlxUiBundleCache.isCachedSync(app.uiHash);
                  return `<span class="slx-ed-dock-item">
                    <a href="${esc(href)}" style="color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:5px;">
                      <span>${esc(app.icon || '🧩')}</span>
                      <span>${esc(app.title)}</span>
                      <span class="slx-ed-mono" style="font-size:.6rem;color:#6ee7b7;">${cached ? '⚡' : '↗'}</span>
                    </a>
                    <button type="button" data-ed-uninstall="${esc(app.slug)}" title="Remove from My Apps" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:.62rem;padding:0 2px;">✕</button>
                  </span>`;
                })
                .join('')}
            </div>
          </div>
          <a href="/apps.html?view=installed" class="slx-ed-mono" style="font-size:.68rem;font-weight:700;color:#38bdf8;text-decoration:none;">Manage Container &amp; Cache →</a>
        `;
      } else {
        refs.dock.innerHTML = `
          <div style="font-size:.73rem;color:#94a3b8;">
            <strong class="slx-ed-mono" style="color:#6ee7b7;">📦 Personal App Container:</strong>
            Choose apps below and click <strong>⬇ Install</strong>—installed apps appear here &amp; in the header <code class="slx-ed-mono">My Apps ▾</code> menu with locally cached HTML for instant loads.
          </div>
          ${state.toastMsg ? `<span class="slx-ed-mono" style="font-size:.68rem;color:#6ee7b7;">${esc(state.toastMsg)}</span>` : `<a href="/apps.html?view=installed" class="slx-ed-mono" style="font-size:.68rem;color:#38bdf8;text-decoration:none;">Manage Cache →</a>`}
        `;
      }
    }

    // Category Pills
    const counts = {};
    for (const a of state.apps) {
      const cid = Number(a.category || 6);
      counts[cid] = (counts[cid] || 0) + 1;
    }
    const pills = [
      { id: 0, label: `All Categories (${state.apps.length})` },
      { id: -1, label: `📦 My Installed (${installed.length})` },
      ...Object.values(APP_CATEGORIES).map((c) => ({
        id: c.id,
        label: `${c.icon} ${c.shortLabel || c.label} (${counts[c.id] || 0})`,
      })),
    ];
    if (refs.cats) {
      refs.cats.innerHTML = pills
        .map(
          (p) =>
            `<button type="button" class="slx-ed-cat slx-ed-mono ${
              state.selectedCat === p.id ? 'active' : ''
            }" data-ed-cat="${p.id}">${esc(p.label)}</button>`
        )
        .join('');
    }

    // Body Cards / Categorized Sections
    if (!refs.body) return;
    if (!state.apps.length) {
      refs.body.innerHTML = `<div class="slx-ed-mono" style="padding:18px;text-align:center;font-size:.75rem;color:#94a3b8;">Loading categorized HFS App Directory…</div>`;
      return;
    }

    const q = state.query.trim().toLowerCase();
    const sourceList =
      state.selectedCat === -1
        ? installed.map((inst) => state.apps.find((a) => a.slug === inst.slug) || inst)
        : state.apps;

    const filtered = sourceList.filter((a) => {
      if (state.selectedCat > 0 && Number(a.category || 6) !== state.selectedCat) return false;
      if (!q) return true;
      const catLabel = APP_CATEGORIES[a.category]?.label || '';
      return (
        String(a.title || '').toLowerCase().includes(q) ||
        String(a.slug || '').toLowerCase().includes(q) ||
        String(a.summary || '').toLowerCase().includes(q) ||
        catLabel.toLowerCase().includes(q) ||
        String(WASM_LABELS_BY_SLUG[a.slug] || '').toLowerCase().includes(q)
      );
    });

    if (state.selectedCat === -1 && !filtered.length) {
      refs.body.innerHTML = `
        <div style="padding:18px;border-radius:11px;border:1px dashed rgba(56,189,248,.4);background:rgba(6,13,26,.85);text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;">
          <div style="font-size:.84rem;font-weight:800;color:#7dd3fc;">No apps installed in your Personal App Container yet</div>
          <div style="font-size:.74rem;color:#cbd5e1;max-width:60ch;">Switch to <strong>All Categories</strong> or any category tab above and click <strong>⬇ Install</strong> on the apps you want pinned and cached locally.</div>
          <button type="button" class="slx-ed-btn slx-ed-btn-em slx-ed-mono" data-ed-cat="0">Browse All Categories (${state.apps.length}) →</button>
        </div>
      `;
      return;
    }

    if (state.selectedCat === 0 && !q) {
      refs.body.innerHTML = Object.values(APP_CATEGORIES)
        .map((cat) => {
          const items = filtered.filter((a) => Number(a.category || 6) === cat.id);
          if (!items.length) return '';
          return `
            <div class="slx-ed-sec">
              <div class="slx-ed-sec-hdr">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <span>${cat.icon}</span>
                  <strong style="font-size:.82rem;color:#f8fafc;">${esc(cat.label)}</strong>
                  <span class="slx-ed-mono" style="font-size:.63rem;color:#7dd3fc;">(${items.length})</span>
                  <span style="font-size:.7rem;color:#94a3b8;">— ${esc(cat.description || '')}</span>
                </div>
                <a href="/apps.html?cat=${encodeURIComponent(cat.key)}" class="slx-ed-mono" style="font-size:.65rem;color:#38bdf8;text-decoration:none;font-weight:700;">Open Category →</a>
              </div>
              <div class="slx-ed-grid">
                ${items.map(renderCard).join('')}
              </div>
            </div>
          `;
        })
        .filter(Boolean)
        .join('');
    } else {
      refs.body.innerHTML = filtered.length
        ? `<div class="slx-ed-grid">${filtered.map(renderCard).join('')}</div>`
        : `<div class="slx-ed-mono" style="padding:16px;text-align:center;font-size:.74rem;color:#94a3b8;">No apps match "${esc(state.query)}".</div>`;
    }
  };

  const hydrateCatalog = async () => {
    try {
      const resp = await fetch('/app-bundles/manifest.json', { cache: 'no-cache' });
      const genesis = resp.ok ? await resp.json() : { apps: state.apps };
      const bySlug = new Map();
      const bySlugId = new Map();
      for (const g of genesis.apps || []) {
        const c = { ...g, source: 'genesis-cas' };
        bySlug.set(g.slug, c);
        if (g.slugId) bySlugId.set(g.slugId.toLowerCase(), c);
      }
      for (const loc of loadLocalPublishedApps()) {
        const key = String(loc.slug || '').toLowerCase();
        const prev = bySlug.get(key) || {};
        const merged = { ...prev, ...loc };
        bySlug.set(key, merged);
        if (merged.slugId) bySlugId.set(merged.slugId.toLowerCase(), merged);
      }
      storeClient.rpcUrl = rpcUrlFn();
      const storeAddr = await storeClient.resolveStoreAddress().catch(() => '');
      if (storeAddr) {
        const onChain = await storeClient.fetchOnChainApps().catch(() => []);
        for (const oc of onChain) {
          const existing = bySlugId.get(String(oc.slugId || '').toLowerCase());
          if (existing) {
            Object.assign(existing, {
              appId: oc.appId,
              title: oc.title || existing.title,
              summary: oc.summary || existing.summary,
              icon: oc.icon || existing.icon,
              version: oc.version || existing.version,
              category: oc.category || existing.category,
              uiHash: oc.uiHash,
              source: 'onchain',
            });
          } else {
            const syn = `app-${oc.appId}`;
            bySlug.set(syn, { ...oc, slug: syn, route: `/apps.html?run=${syn}`, source: 'onchain' });
          }
        }
      }
      state.apps = Array.from(bySlug.values());
      cacheCatalogManifestLocal({ apps: state.apps });
      SlxPersonalAppContainer.syncCatalogMetadata(state.apps);
      renderAll();
    } catch (_) {
      renderAll();
    }
  };

  refs.archBtn?.addEventListener('click', () => {
    openSlxUseCaseDescription('apps', 'codification', { currentPageAppId: isSlideMode ? 'deck' : 'apps' });
  });

  refs.search?.addEventListener('input', (ev) => {
    state.query = ev.currentTarget.value || '';
    renderAll();
  });

  hostEl.addEventListener('click', async (ev) => {
    const catBtn = ev.target.closest('[data-ed-cat]');
    if (catBtn) {
      state.selectedCat = Number(catBtn.getAttribute('data-ed-cat'));
      renderAll();
      return;
    }
    const docBtn = ev.target.closest('[data-ed-doc]');
    if (docBtn) {
      openSlxUseCaseDescription(docBtn.getAttribute('data-ed-doc'), 'codification', {
        currentPageAppId: isSlideMode ? 'deck' : 'apps',
      });
      return;
    }
    const instBtn = ev.target.closest('[data-ed-install]');
    if (instBtn) {
      const slug = instBtn.getAttribute('data-ed-install');
      const appMeta = state.apps.find((a) => a.slug === slug);
      if (!appMeta || state.installingSlugs.has(slug)) return;
      state.installingSlugs.add(slug);
      renderAll();
      try {
        storeClient.rpcUrl = rpcUrlFn();
        await SlxPersonalAppContainer.installApp(appMeta, { storeClient });
        state.toastMsg = `✓ Installed & cached "${appMeta.title}"`;
      } catch (err) {
        state.toastMsg = `⚠ ${err.message || err}`;
      } finally {
        state.installingSlugs.delete(slug);
        renderAll();
      }
      return;
    }
    const uninstBtn = ev.target.closest('[data-ed-uninstall]');
    if (uninstBtn) {
      const slug = uninstBtn.getAttribute('data-ed-uninstall');
      await SlxPersonalAppContainer.uninstallApp(slug);
      state.toastMsg = '';
      renderAll();
    }
  });

  const unsub = SlxPersonalAppContainer.onChange(() => renderAll());
  renderAll();
  hydrateCatalog();

  return {
    refresh: hydrateCatalog,
    destroy: () => unsub(),
  };
}
