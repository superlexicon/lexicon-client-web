/**
 * SuperLexicon App Store & Zero-Infrastructure Directory (`src/apps.js`)
 *
 * Showcases and runs all 12 converted SuperLexicon flagship HFS apps + community zero-trust
 * sandboxed apps from `gzip`-compressed, `keccak256`-verified UI bundles (`app_store.wasm`)—with
 * zero backend servers, zero databases, and zero EC2 instances.
 */

import {
  SlxWalletManager,
  SlxClient,
  getDefaultNodeWsUrl,
  shortHex,
  keccak256Hex,
  ZERO_ADDR,
  ZERO_BYTES32,
  APP_CATEGORIES,
  APP_EXEC_MODE,
  HFS_ASSOC_STATUS,
  AppStoreClient,
  compressAppUiBundle,
  loadLocalPublishedApps,
  buildSandboxedIframeSrcdoc,
  attachSandboxedAppBridge,
} from '@superlexicon/sdk';
import {
  mountSlxUnifiedHeader,
  openSlxUseCaseDescription,
  USECASE_DESCRIPTIONS,
} from '@superlexicon/sdk/ui';
import { loadGenesisAppCatalog, resolveEffectiveAppMeta } from './app-host-runtime.js';

const wallet = new SlxWalletManager();
const rpcUrl = getDefaultNodeWsUrl();
const client = new SlxClient(rpcUrl);
const storeClient = new AppStoreClient({ rpcUrl });

mountSlxUnifiedHeader({
  mountContainer: document.getElementById('slxUnifiedHeaderMount'),
  activeAppId: 'apps',
  wallet,
  client,
  title: 'HFS App Store & Directory',
  subtitle: 'Zero Backend • Zero Database • Zero EC2 • On-Chain WASM + Gzipped HTML Bundles',
});

const WASM_LABELS_BY_SLUG = {
  accounting: 'accounting_ledger.wasm + confidential_ledger.wasm',
  charter: 'corporate_charter.wasm + share_capital.wasm',
  dex: 'dex_clob.wasm + asset_ledger.wasm',
  commerce: 'product_ledger.wasm + accounting_ledger.wasm',
  crowdfunding: 'crowdfunding.wasm + accounting_ledger.wasm',
  rewards: 'reward_voucher.wasm',
  ballot: 'secret_ballot.wasm',
  social: 'social_charter.wasm + messaging.wasm',
  battleship: 'battleship.wasm',
  'cipher-noir': 'cipher_noir.wasm',
  hegemony: 'hegemony.wasm',
  lottery: 'lottery.wasm + vrf_beacon.wasm',
};

const STUDIO_SNIPPETS = {
  identity: `\n// Instant cryptographic login (replaces Auth0 / JWT / User DB):\nconst ctx = await window.slx.getContext();\nconsole.log('Logged in as:', ctx.user.nickname, ctx.user.identityAddr);\n`,
  read: `\n// Read directly from on-chain HFS WorldState (replaces Postgres SELECT + REST GET):\nconst rawHex = await window.slx.callContract('totalCount()', []);\n`,
  write: `\n// $0.00-gas signed state write via Identity HFS (replaces EC2 API POST + SQL INSERT):\nconst receipt = await window.slx.sendTransaction({\n  fnSig: 'submitEntry(string)',\n  args: [['string', 'Stored directly in HFS WorldState!']],\n  summary: 'Record entry in Halt-Free Subroutine'\n});\n`,
};

const state = {
  activeView: 'catalog',
  selectedCategory: 0,
  searchQuery: '',
  storeAddr: '',
  busy: false,
  apps: [],
  runningApp: null,
  activeBridge: null,
  uploadedWasmBytes: null,
};

const BLANK_STARTER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Zero-Server HFS App</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #050b16; color: #f8fafc; font-family: system-ui, sans-serif; }
    .card { max-width: 660px; margin: 0 auto; padding: 22px; border-radius: 16px; background: #0a1428; border: 1px solid rgba(52,211,153,0.45); }
    .tag { display: inline-block; padding: 3px 10px; border-radius: 999px; background: rgba(16,185,129,0.18); border: 1px solid rgba(52,211,153,0.5); color: #6ee7b7; font-family: monospace; font-size: 11px; font-weight: 800; }
    input { width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid #334155; background: #030712; color: #f8fafc; font-family: monospace; margin-top: 10px; }
    button { margin-top: 10px; padding: 9px 15px; border-radius: 9px; border: 1px solid #34d399; background: rgba(16,185,129,0.24); color: #d1fae5; font-family: monospace; font-weight: 800; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <span class="tag">0 EC2 Servers • 0 SQL Databases • $0.00 Gas</span>
    <h2 style="margin:12px 0 4px;">⚡ My Zero-Server HFS App</h2>
    <p id="who" style="color:#94a3b8;font-family:monospace;font-size:12.5px;margin:0;">Connecting to window.slx…</p>
    <input id="noteIn" placeholder="Write a note to commit via your Identity HFS…" />
    <button onclick="saveNote()">✍️ Sign &amp; Commit ($0.00 Gas)</button>
    <div id="notesOut" style="margin-top:14px;font-family:monospace;font-size:12px;color:#bae6fd;"></div>
  </div>
  <script>
    let items = [];
    async function boot() {
      const ctx = await window.slx.getContext();
      document.getElementById('who').textContent =
        'Identity: ' + ctx.user.nickname + ' · ' + ctx.user.tag4 + ' | Subnet Block #' + ctx.blockNumber;
      items = (await window.slx.getAppStorage('notes')) || [];
      render();
    }
    function render() {
      document.getElementById('notesOut').innerHTML = items.map(x =>
        '<div style="padding:7px 0;border-bottom:1px solid #1e293b;">✓ ' + x.replace(/</g, '&lt;') + '</div>'
      ).join('');
    }
    async function saveNote() {
      const val = document.getElementById('noteIn').value.trim();
      if (!val) return;
      const res = await window.slx.sendTransaction({
        fnSig: 'recordNote(string)',
        args: [['string', val]],
        summary: 'Commit note: "' + val.slice(0, 40) + '"'
      });
      items.unshift(val + ' (' + String(res.txHash).slice(0, 12) + '…)');
      await window.slx.setAppStorage('notes', items);
      document.getElementById('noteIn').value = '';
      render();
    }
    boot();
  <\/script>
</body>
</html>`;

function showToast(msg, tone = 'info') {
  const el = document.getElementById('asToast');
  if (!el) return;
  el.style.display = 'block';
  if (tone === 'err') {
    el.style.borderColor = 'rgba(244,63,94,0.65)';
    el.style.background = 'rgba(225,29,72,0.2)';
    el.style.color = '#fecdd3';
  } else if (tone === 'ok') {
    el.style.borderColor = 'rgba(52,211,153,0.65)';
    el.style.background = 'rgba(16,185,129,0.2)';
    el.style.color = '#d1fae5';
  } else {
    el.style.borderColor = 'rgba(56,189,248,0.5)';
    el.style.background = 'rgba(14,165,233,0.16)';
    el.style.color = '#e0f2fe';
  }
  el.textContent = msg;
}

function setView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.as-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.getElementById('viewCatalog').style.display = viewName === 'catalog' ? 'flex' : 'none';
  document.getElementById('viewRunner').style.display = viewName === 'runner' ? 'flex' : 'none';
  document.getElementById('viewStudio').style.display = viewName === 'studio' ? 'block' : 'none';
}

function openCreateNewAppStudio() {
  loadAppIntoStudio('__blank__');
  document.getElementById('viewStudio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refreshMergedCatalog() {
  const genesis = await loadGenesisAppCatalog();
  const bySlug = new Map();
  const bySlugId = new Map();

  for (const g of genesis.apps || []) {
    const copy = { ...g, source: 'genesis-cas' };
    bySlug.set(g.slug, copy);
    if (g.slugId) bySlugId.set(g.slugId.toLowerCase(), copy);
  }

  for (const loc of loadLocalPublishedApps()) {
    const key = String(loc.slug || '').toLowerCase();
    const prev = bySlug.get(key) || {};
    const merged = { ...prev, ...loc };
    if (prev.uiHash && merged.uiHash && prev.uiHash.toLowerCase() !== merged.uiHash.toLowerCase()) {
      merged.bundleUrl = '';
    }
    bySlug.set(key, merged);
    if (merged.slugId) bySlugId.set(merged.slugId.toLowerCase(), merged);
  }

  const storeAddr = await storeClient.resolveStoreAddress();
  state.storeAddr = storeAddr;
  if (storeAddr) {
    const onChainItems = await storeClient.fetchOnChainApps();
    for (const oc of onChainItems) {
      const existing = bySlugId.get(oc.slugId.toLowerCase());
      if (existing) {
        const uiChanged = existing.uiHash?.toLowerCase() !== oc.uiHash.toLowerCase();
        Object.assign(existing, {
          appId: oc.appId,
          title: oc.title || existing.title,
          summary: oc.summary || existing.summary,
          icon: oc.icon || existing.icon,
          version: oc.version || existing.version,
          category: oc.category || existing.category,
          uiHash: oc.uiHash,
          wasmCodeHash: oc.wasmCodeHash !== ZERO_BYTES32 ? oc.wasmCodeHash : existing.wasmCodeHash,
          defaultHfsAddr: oc.defaultHfsAddr !== ZERO_ADDR ? oc.defaultHfsAddr : existing.defaultHfsAddr,
          releaseCount: oc.releaseCount,
          updatedBlock: oc.updatedBlock,
          bundleUrl: uiChanged ? '' : existing.bundleUrl,
          source: 'onchain',
        });
      } else {
        const syntheticSlug = `app-${oc.appId}`;
        bySlug.set(syntheticSlug, {
          ...oc,
          slug: syntheticSlug,
          route: `/apps.html?run=${syntheticSlug}`,
          source: 'onchain',
        });
      }
    }
  }

  state.apps = Array.from(bySlug.values());
  renderHeaderStatus();
  renderCategories();
  renderAppsGrid();
  populateStudioTemplates();
}

function renderHeaderStatus() {
  const lbl = document.getElementById('lblStoreAddr');
  const btnDep = document.getElementById('btnDeployStoreHfs');
  const btnSync = document.getElementById('btnSyncAllCatalogOnChain');
  document.getElementById('lblAppCount').textContent = String(state.apps.length);

  if (state.storeAddr) {
    lbl.textContent = `${shortHex(state.storeAddr, 8, 6)} • Live Subnet 1`;
    btnDep.textContent = '✓ AppStore Deployed';
    btnDep.disabled = true;
    btnSync.disabled = state.busy;
  } else {
    lbl.textContent = 'Verified Local CAS (Deployable to Subnet 1)';
    btnDep.textContent = '⛓️ Deploy AppStore HFS';
    btnDep.disabled = state.busy;
    btnSync.disabled = true;
  }
}

function renderCategories() {
  const bar = document.getElementById('catBar');
  const pills = [
    { id: 0, label: `All Directory (${state.apps.length})` },
    ...Object.values(APP_CATEGORIES).map((c) => ({
      id: c.id,
      label: `${c.icon} ${c.label}`,
    })),
  ];
  bar.innerHTML = pills
    .map(
      (p) =>
        `<button type="button" class="as-cat-pill ${
          state.selectedCategory === p.id ? 'active' : ''
        }" data-cat="${p.id}">${p.label}</button>`
    )
    .join('');
}

function renderAppsGrid() {
  const grid = document.getElementById('appsGrid');
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.apps.filter((a) => {
    if (state.selectedCategory && Number(a.category) !== state.selectedCategory) return false;
    if (!q) return true;
    return (
      String(a.title || '').toLowerCase().includes(q) ||
      String(a.slug || '').toLowerCase().includes(q) ||
      String(a.summary || '').toLowerCase().includes(q) ||
      String(WASM_LABELS_BY_SLUG[a.slug] || '').toLowerCase().includes(q) ||
      String(a.uiHash || '').toLowerCase().includes(q)
    );
  });

  const appCardsHtml = filtered
    .map((a) => {
      const catMeta = APP_CATEGORIES[a.category] || APP_CATEGORIES[6];
      const gzKb = a.compressedLen ? (a.compressedLen / 1024).toFixed(1) + ' KiB gz' : 'Verified CAS';
      const isHostCore = a.execMode === APP_EXEC_MODE.VERIFIED_HOST || a.isSystemCore;
      const wasmName =
        WASM_LABELS_BY_SLUG[a.slug] ||
        (a.wasmCodeHash && a.wasmCodeHash !== ZERO_BYTES32
          ? `HFS ${shortHex(a.wasmCodeHash, 8, 6)}`
          : 'window.slx Host State');
      const hasArchDoc = Boolean(USECASE_DESCRIPTIONS[a.slug]);

      const primaryRunBtn =
        isHostCore && a.route
          ? `<a href="${a.route}" class="as-btn as-btn-emerald" style="flex:1;justify-content:center;">▶ Launch App</a>`
          : `<button type="button" class="as-btn as-btn-emerald" style="flex:1;justify-content:center;" data-sandbox-slug="${a.slug}">▶ Launch App</button>`;

      return `
        <article class="as-card">
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
              <div style="display:flex;align-items:center;gap:11px;min-width:0;">
                <div class="as-app-icon">${a.icon || '🧩'}</div>
                <div style="min-width:0;">
                  <div style="font-size:0.96rem;font-weight:800;color:#f8fafc;line-height:1.25;">${String(a.title).replace(/</g, '&lt;')}</div>
                  <div class="mono" style="font-size:0.67rem;color:#94a3b8;margin-top:2px;">
                    ${catMeta.label} • v${a.version || '1.0.0'}
                  </div>
                </div>
              </div>
              <span class="as-badge ${a.source === 'onchain' ? 'as-badge-amber' : 'as-badge-emerald'} mono">
                ${a.source === 'onchain' ? `⛓️ On-Chain #${a.appId}` : '✓ Zero-EC2'}
              </span>
            </div>

            <div style="font-size:0.76rem;color:#cbd5e1;line-height:1.48;">
              ${String(a.summary || '').replace(/</g, '&lt;')}
            </div>

            <div class="as-stack-row mono">
              <span title="Replaces EC2 / API Backend">⚙️ <strong style="color:#7dd3fc;">${wasmName}</strong></span>
              <span>•</span>
              <span title="Gzipped Single-File HTML UI Bundle">📦 <strong style="color:#6ee7b7;">${gzKb}</strong></span>
              <span>•</span>
              <span title="keccak256 UI Bundle Digest">🔒 ${shortHex(a.uiHash || '', 6, 4)}</span>
            </div>
          </div>

          <div style="display:flex;gap:7px;flex-wrap:wrap;">
            ${primaryRunBtn}
            ${
              hasArchDoc
                ? `<button type="button" class="as-btn as-btn-violet" data-doc-slug="${a.slug}" title="View Zero-Server HFS Architecture & Cryptographic Spec">🏛️ Spec</button>`
                : isHostCore
                ? `<button type="button" class="as-btn" data-sandbox-slug="${a.slug}" title="Run inside isolated iframe">🛡️ Sandbox</button>`
                : ''
            }
            <button type="button" class="as-btn as-btn-amber" data-fork-slug="${a.slug}" title="Inspect HTML/CSS/JS source or publish an updated version">✏ Fork</button>
          </div>
        </article>
      `;
    })
    .join('');

  const createCardHtml = `
    <article class="as-card as-card-create">
      <div style="display:flex;flex-direction:column;gap:9px;">
        <div class="as-app-icon" style="border-color:rgba(52,211,153,0.55);background:rgba(16,185,129,0.2);">➕</div>
        <div style="font-size:0.98rem;font-weight:800;color:#6ee7b7;">Build &amp; Publish a New App</div>
        <div style="font-size:0.76rem;color:#cbd5e1;line-height:1.5;">
          Have an idea for a DAO tool, marketplace, RF utility, or multiplayer game? Package your HTML UI + Halt-Free Subroutine directly into this Directory—<strong>no backend server, no database, and no EC2 instance required</strong>.
        </div>
      </div>
      <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap;">
        <button type="button" id="btnCardCreateNew" class="as-btn as-btn-emerald" style="flex:1;justify-content:center;">➕ Create / Publish App →</button>
        <button type="button" id="btnCardReadGuide" class="as-btn" style="justify-content:center;">📖 Read Guide</button>
      </div>
    </article>
  `;

  grid.innerHTML = appCardsHtml + createCardHtml;

  document.getElementById('btnCardCreateNew')?.addEventListener('click', openCreateNewAppStudio);
  document.getElementById('btnCardReadGuide')?.addEventListener('click', () => {
    const drawer = document.getElementById('zeroInfraGuideDrawer');
    drawer?.classList.add('open');
    drawer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function promptHostTxConfirmation({ appMeta, target, fnSig, summary, dataHex }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('hostTxConfirmModal');
    document.getElementById('txModalAppName').textContent = `${appMeta.icon || '🧩'} ${appMeta.title}`;
    document.getElementById('txModalDetails').innerHTML =
      `Action: <strong style="color:#fde68a;">${(summary || fnSig || 'Call HFS').replace(/</g, '&lt;')}</strong><br/>` +
      `Target HFS: <code>${target}</code><br/>` +
      `Function: <code>${fnSig}</code><br/>` +
      `Calldata: <code>${String(dataHex || '0x').slice(0, 66)}${String(dataHex || '').length > 66 ? '…' : ''}</code>`;
    const trustChk = document.getElementById('chkTrustSessionTarget');
    trustChk.checked = false;
    modal.classList.add('open');

    const cleanup = (decision) => {
      modal.classList.remove('open');
      btnApprove.onclick = null;
      btnReject.onclick = null;
      resolve(decision);
    };
    const btnApprove = document.getElementById('btnApproveSandboxTx');
    const btnReject = document.getElementById('btnRejectSandboxTx');
    btnApprove.onclick = () => cleanup({ approved: true, trustSession: trustChk.checked });
    btnReject.onclick = () => cleanup({ approved: false, trustSession: false });
  });
}

async function launchInSandboxRunner(slugOrMeta, { rawHtmlOverride = null } = {}) {
  try {
    const appMeta =
      typeof slugOrMeta === 'string'
        ? (await resolveEffectiveAppMeta(slugOrMeta, storeClient)) ||
          state.apps.find((x) => x.slug === slugOrMeta)
        : slugOrMeta;
    if (!appMeta) throw new Error('App metadata not found.');

    let html = rawHtmlOverride;
    let verifiedHash = appMeta.uiHash || ZERO_BYTES32;
    if (!html) {
      const verified = await storeClient.fetchVerifiedBundleHtml({
        uiHash: appMeta.uiHash,
        fallbackBundleUrl: appMeta.bundleUrl || '',
      });
      html = verified.html;
      verifiedHash = verified.uiHash;
    }

    if (state.activeBridge) {
      state.activeBridge.destroy();
      state.activeBridge = null;
    }

    state.runningApp = { ...appMeta, uiHash: verifiedHash };
    document.getElementById('runnerTitle').textContent = `${appMeta.icon || '🧩'} ${appMeta.title} (v${
      appMeta.version || '1.0.0'
    })`;
    document.getElementById('runnerVerifyBadge').textContent = rawHtmlOverride
      ? '👁️ Live Studio Preview'
      : `✓ keccak256 ${shortHex(verifiedHash, 8, 6)}`;

    const lnkFull = document.getElementById('lnkRunnerStandalone');
    if (appMeta.isSystemCore && appMeta.route) {
      lnkFull.href = appMeta.route;
      lnkFull.style.display = 'inline-flex';
    } else {
      lnkFull.style.display = 'none';
    }

    const iframe = document.getElementById('sandboxedAppIframe');
    iframe.srcdoc = buildSandboxedIframeSrcdoc(html);
    state.activeBridge = attachSandboxedAppBridge({
      iframeEl: iframe,
      appMeta: state.runningApp,
      wallet,
      rpcUrl,
      onConfirmTx: promptHostTxConfirmation,
    });

    setView('runner');
  } catch (err) {
    showToast(`Runner error: ${err.message || err}`, 'err');
  }
}

function populateStudioTemplates() {
  const sel = document.getElementById('selStudioTemplate');
  const prev = sel.value;
  const opts = [
    `<option value="__blank__">✨ New Blank Zero-Server App (window.slx Starter)</option>`,
    ...state.apps.map(
      (a) =>
        `<option value="${a.slug}">${a.icon || '🧩'} Fork / Edit Directory App: ${a.title} (${a.slug})</option>`
    ),
  ];
  sel.innerHTML = opts.join('');
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

async function loadAppIntoStudio(slug) {
  if (slug === '__blank__') {
    document.getElementById('selStudioTemplate').value = '__blank__';
    document.getElementById('inStudioSlug').value = 'my-zero-server-app';
    document.getElementById('inStudioTitle').value = 'My Zero-Server HFS App';
    document.getElementById('inStudioIcon').value = '⚡';
    document.getElementById('inStudioVersion').value = '1.0.0';
    document.getElementById('selStudioCategory').value = '6';
    document.getElementById('inStudioSummary').value =
      'Runs 100% on-chain via Halt-Free Subroutines & gzipped HTML—zero backend, zero database, zero EC2.';
    document.getElementById('inStudioWasmHash').value = '';
    document.getElementById('inStudioDefaultHfs').value = '';
    document.getElementById('txtStudioHtml').value = BLANK_STARTER_HTML;
    await updateStudioMeter();
    setView('studio');
    return;
  }

  const appMeta =
    (await resolveEffectiveAppMeta(slug, storeClient)) || state.apps.find((a) => a.slug === slug);
  if (!appMeta) return;

  const verified = await storeClient.fetchVerifiedBundleHtml({
    uiHash: appMeta.uiHash,
    fallbackBundleUrl: appMeta.bundleUrl || '',
  });

  document.getElementById('selStudioTemplate').value = appMeta.slug;
  document.getElementById('inStudioSlug').value = appMeta.slug;
  document.getElementById('inStudioTitle').value = appMeta.title;
  document.getElementById('inStudioIcon').value = appMeta.icon || '🧩';
  const verParts = String(appMeta.version || '1.0.0').split('.');
  verParts[verParts.length - 1] = String((Number(verParts[verParts.length - 1]) || 0) + 1);
  document.getElementById('inStudioVersion').value = verParts.join('.');
  document.getElementById('selStudioCategory').value = String(appMeta.category || 6);
  document.getElementById('inStudioSummary').value = appMeta.summary || '';
  document.getElementById('inStudioWasmHash').value =
    appMeta.wasmCodeHash && appMeta.wasmCodeHash !== ZERO_BYTES32 ? appMeta.wasmCodeHash : '';
  document.getElementById('inStudioDefaultHfs').value =
    appMeta.defaultHfsAddr && appMeta.defaultHfsAddr !== ZERO_ADDR ? appMeta.defaultHfsAddr : '';
  document.getElementById('txtStudioHtml').value = verified.html;

  await updateStudioMeter();
  setView('studio');
  showToast(
    `Loaded "${appMeta.title}" (${(verified.uncompressedLen / 1024).toFixed(1)} KiB HTML) into Studio — edit & click Publish to ship v${verParts.join('.')} with zero servers & zero client redeploys!`,
    'info'
  );
}

async function updateStudioMeter() {
  const html = document.getElementById('txtStudioHtml').value || '';
  const packed = await compressAppUiBundle(html);
  const airtimeMs = Math.max(8, Math.round((packed.compressedLen * 8) / 2_600));
  document.getElementById('studioBundleMeter').innerHTML =
    `Raw HTML+CSS+JS: <strong style="color:#f8fafc;">${(packed.uncompressedLen / 1024).toFixed(1)} KiB</strong><br/>` +
    `Gzip On-Chain Bundle: <strong style="color:#6ee7b7;">${(packed.compressedLen / 1024).toFixed(1)} KiB</strong> (${packed.chunkCount} chunk${packed.chunkCount === 1 ? '' : 's'} @ 32 KiB)<br/>` +
    `LR2021 Radio-2 Air Sync: <strong style="color:#7dd3fc;">~${airtimeMs} ms</strong> • Cloud Bill: <strong style="color:#6ee7b7;">$0.00/mo</strong><br/>` +
    `uiHash: <code>${shortHex(packed.uiHash, 12, 8)}</code>`;
}

// Wire Events
document.querySelectorAll('.as-tab').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});
document.getElementById('btnHeroCreateApp').addEventListener('click', openCreateNewAppStudio);
document.getElementById('btnToolbarCreateApp').addEventListener('click', openCreateNewAppStudio);
document.getElementById('btnGuideStartBuilding').addEventListener('click', openCreateNewAppStudio);

document.getElementById('btnToggleZeroGuide').addEventListener('click', () => {
  const drawer = document.getElementById('zeroInfraGuideDrawer');
  drawer.classList.toggle('open');
  if (drawer.classList.contains('open')) {
    drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});
document.getElementById('btnCloseZeroGuide').addEventListener('click', () => {
  document.getElementById('zeroInfraGuideDrawer').classList.remove('open');
});
document.getElementById('btnOpenArchSpec').addEventListener('click', () => {
  openSlxUseCaseDescription('apps', 'codification', { currentPageAppId: 'apps' });
});

document.getElementById('btnRunnerBack').addEventListener('click', () => setView('catalog'));

document.getElementById('catBar').addEventListener('click', (ev) => {
  const pill = ev.target.closest('[data-cat]');
  if (!pill) return;
  state.selectedCategory = Number(pill.dataset.cat);
  renderCategories();
  renderAppsGrid();
});

document.getElementById('inSearchApps').addEventListener('input', (ev) => {
  state.searchQuery = ev.currentTarget.value;
  renderAppsGrid();
});

document.getElementById('appsGrid').addEventListener('click', async (ev) => {
  const docBtn = ev.target.closest('[data-doc-slug]');
  if (docBtn) {
    openSlxUseCaseDescription(docBtn.dataset.docSlug, 'codification', { currentPageAppId: 'apps' });
    return;
  }
  const sbBtn = ev.target.closest('[data-sandbox-slug]');
  if (sbBtn) {
    await launchInSandboxRunner(sbBtn.dataset.sandboxSlug);
    return;
  }
  const fkBtn = ev.target.closest('[data-fork-slug]');
  if (fkBtn) {
    await loadAppIntoStudio(fkBtn.dataset.forkSlug);
  }
});

document.querySelectorAll('[data-snippet]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-snippet');
    const snippet = STUDIO_SNIPPETS[key];
    if (!snippet) return;
    const ed = document.getElementById('txtStudioHtml');
    const cur = ed.value;
    const closeIdx = cur.lastIndexOf('</script>');
    if (closeIdx >= 0) {
      ed.value = cur.slice(0, closeIdx) + snippet + cur.slice(closeIdx);
    } else {
      ed.value = cur + `\n<script>${snippet}<\/script>\n`;
    }
    updateStudioMeter();
    showToast(`Inserted "${key}" window.slx snippet into HTML bundle.`, 'ok');
  });
});

document.getElementById('btnResolveHfsAddr').addEventListener('click', async () => {
  const addr = document.getElementById('inResolveHfsAddr').value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    showToast('Enter a valid 20-byte 0x… HFS contract address.', 'err');
    return;
  }
  const byDefault = state.apps.find((a) => (a.defaultHfsAddr || '').toLowerCase() === addr);
  if (byDefault) {
    if (byDefault.isSystemCore && byDefault.route) {
      window.location.href = `${byDefault.route}?hfs=${encodeURIComponent(addr)}`;
    } else {
      await launchInSandboxRunner({ ...byDefault, activeInstanceAddr: addr });
    }
    return;
  }
  const resolved = await storeClient.resolveInstanceApp(addr);
  if (resolved) {
    const hit = state.apps.find((a) => a.appId === resolved.appId);
    if (hit) {
      await launchInSandboxRunner({ ...hit, uiHash: resolved.uiHash, activeInstanceAddr: addr });
      return;
    }
  }
  showToast(`No UI bundle bound yet in AppStore for HFS ${shortHex(addr)}.`, 'err');
});

document.getElementById('btnRunnerFork').addEventListener('click', async () => {
  if (state.runningApp?.slug) {
    await loadAppIntoStudio(state.runningApp.slug);
  }
});

document.getElementById('btnRunnerWhitelist').addEventListener('click', async () => {
  const target = state.runningApp?.activeInstanceAddr || state.runningApp?.defaultHfsAddr;
  if (!target || target === ZERO_ADDR) {
    showToast('This app runs pure UI/sandbox state without a fixed HFS contract target.', 'info');
    return;
  }
  try {
    await wallet.setHfsAssociation({
      hfsAddr: target,
      typeName: 'APP_STORE',
      status: HFS_ASSOC_STATUS.WHITELISTED,
      label: state.runningApp.title,
      rpcUrl,
    });
    showToast(`✓ Whitelisted ${shortHex(target)} (State = 2) on your Identity HFS!`, 'ok');
  } catch (err) {
    showToast(`Whitelist note: ${err.message || err}`, 'err');
  }
});

document.getElementById('btnDeployStoreHfs').addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  renderHeaderStatus();
  try {
    const addr = await storeClient.deployAppStoreOnChain({
      wallet,
      onStatus: (m) => showToast(m, 'info'),
    });
    state.storeAddr = addr;
    showToast(`✅ Deployed & initialized AppStore HFS on Subnet 1 at ${addr}!`, 'ok');
    await refreshMergedCatalog();
  } catch (err) {
    showToast(`Deploy AppStore note: ${err.message || err}`, 'err');
  } finally {
    state.busy = false;
    renderHeaderStatus();
  }
});

document.getElementById('btnSyncAllCatalogOnChain').addEventListener('click', async () => {
  if (state.busy || !state.storeAddr) return;
  state.busy = true;
  renderHeaderStatus();
  try {
    let count = 0;
    for (const app of state.apps) {
      showToast(`Syncing [${count + 1}/${state.apps.length}] "${app.title}" to Subnet 1 AppStore…`, 'info');
      const verified = await storeClient.fetchVerifiedBundleHtml({
        uiHash: app.uiHash,
        fallbackBundleUrl: app.bundleUrl || '',
      });
      await storeClient.publishApp({
        wallet,
        slug: app.slug,
        title: app.title,
        summary: app.summary,
        icon: app.icon,
        version: app.version,
        category: app.category,
        execMode: app.isSystemCore ? APP_EXEC_MODE.VERIFIED_HOST : APP_EXEC_MODE.SANDBOX_IFRAME,
        htmlSource: verified.html,
        wasmCodeHash: app.wasmCodeHash || ZERO_BYTES32,
        defaultHfsAddr: app.defaultHfsAddr || ZERO_ADDR,
      });
      count += 1;
    }
    showToast(`🎉 Synced all ${count} verified UI bundles & HFS listings onto Subnet 1 AppStore!`, 'ok');
    await refreshMergedCatalog();
  } catch (err) {
    showToast(`Catalog sync error: ${err.message || err}`, 'err');
  } finally {
    state.busy = false;
    renderHeaderStatus();
  }
});

document.getElementById('selStudioTemplate').addEventListener('change', (ev) => {
  loadAppIntoStudio(ev.currentTarget.value);
});
document.getElementById('txtStudioHtml').addEventListener('input', () => {
  updateStudioMeter();
});
document.getElementById('inStudioHtmlFile').addEventListener('change', async (ev) => {
  const file = ev.currentTarget.files?.[0];
  if (!file) return;
  document.getElementById('txtStudioHtml').value = await file.text();
  await updateStudioMeter();
});
document.getElementById('inStudioWasmFile').addEventListener('change', async (ev) => {
  const file = ev.currentTarget.files?.[0];
  if (!file) {
    state.uploadedWasmBytes = null;
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  state.uploadedWasmBytes = bytes;
  document.getElementById('inStudioWasmHash').value = keccak256Hex(bytes);
  showToast(`Computed WASM codeHash: ${shortHex(keccak256Hex(bytes))} (${(bytes.length / 1024).toFixed(1)} KiB)`, 'ok');
});

document.getElementById('btnStudioPreview').addEventListener('click', async () => {
  const html = document.getElementById('txtStudioHtml').value;
  const slug = document.getElementById('inStudioSlug').value.trim() || 'preview-app';
  const title = document.getElementById('inStudioTitle').value.trim() || 'Studio Preview';
  const icon = document.getElementById('inStudioIcon').value.trim() || '⚡';
  const version = document.getElementById('inStudioVersion').value.trim() || '1.0.0';
  await launchInSandboxRunner(
    { slug, title, icon, version, execMode: APP_EXEC_MODE.SANDBOX_IFRAME },
    { rawHtmlOverride: html }
  );
});

document.getElementById('btnStudioPublish').addEventListener('click', async () => {
  if (state.busy) return;
  const slug = document.getElementById('inStudioSlug').value.trim();
  const title = document.getElementById('inStudioTitle').value.trim();
  const icon = document.getElementById('inStudioIcon').value.trim() || '🧩';
  const version = document.getElementById('inStudioVersion').value.trim() || '1.0.0';
  const category = Number(document.getElementById('selStudioCategory').value || 6);
  const summary = document.getElementById('inStudioSummary').value.trim();
  const wasmCodeHash = document.getElementById('inStudioWasmHash').value.trim() || ZERO_BYTES32;
  const defaultHfsAddr = document.getElementById('inStudioDefaultHfs').value.trim() || ZERO_ADDR;
  const deployInstance = document.getElementById('chkStudioDeployInst').checked;
  const htmlSource = document.getElementById('txtStudioHtml').value;

  if (!slug || !title || !htmlSource.trim()) {
    showToast('Slug, Title, and HTML Bundle Source are required.', 'err');
    return;
  }

  state.busy = true;
  renderHeaderStatus();
  try {
    const existing = state.apps.find((a) => a.slug === slug);
    const published = await storeClient.publishApp({
      wallet,
      slug,
      title,
      summary,
      icon,
      version,
      category,
      execMode: existing?.isSystemCore ? APP_EXEC_MODE.VERIFIED_HOST : APP_EXEC_MODE.SANDBOX_IFRAME,
      htmlSource,
      wasmBytes: state.uploadedWasmBytes,
      wasmCodeHash,
      defaultHfsAddr,
      deployInstance,
      onStatus: (m) => showToast(m, 'info'),
    });
    await refreshMergedCatalog();
    showToast(
      `🎉 Published "${published.title}" v${published.version} (uiHash ${shortHex(
        published.uiHash
      )})! Live in the App Directory immediately—no EC2, no DB, no web-client redeploy.`,
      'ok'
    );
    setView('catalog');
  } catch (err) {
    showToast(`Publish error: ${err.message || err}`, 'err');
  } finally {
    state.busy = false;
    renderHeaderStatus();
  }
});

// Boot
document.getElementById('txtStudioHtml').value = BLANK_STARTER_HTML;
await updateStudioMeter();
await refreshMergedCatalog();

const params = new URLSearchParams(window.location.search);
if (params.get('create') === '1') {
  openCreateNewAppStudio();
} else if (params.get('edit')) {
  await loadAppIntoStudio(params.get('edit'));
} else if (params.get('run')) {
  await launchInSandboxRunner(params.get('run'));
} else if (params.get('guide') === '1') {
  document.getElementById('zeroInfraGuideDrawer').classList.add('open');
}
