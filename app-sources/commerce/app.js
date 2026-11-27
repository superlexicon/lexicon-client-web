/**
 * SuperLexicon E-Commerce Storefront (`/commerce.html`)
 * Live WebSocket client for `product_ledger.wasm` + `accounting_ledger.wasm` + `asset_ledger.wasm` (`SGD-FIAT`).
 */

import {
  SlxInstSession,
  encodeAbi,
  decodeUintWord,
  decodeCatalogSnapshotHex,
  decodeSaleRecordHex,
  readU64BE,
  shortAddr,
  fmtNum,
  escapeHtml,
} from '@superlexicon/sdk/inst-suite';
import {
  GL_SCENARIO_BLUEPRINTS,
  buildLiveProductCheckoutPreview,
  renderHumanBlueprintHtml,
} from '@superlexicon/sdk/ifrs-human-gl';
import { hexToBytes, slxWatchChainApp, createSingleFlightRefresh } from '@superlexicon/sdk';

const SKU_ICONS_BY_CODE = {
  'SLX-USB-DONGLE': '🔌',
  'SLX-WATCH-ULTRA': '⌚',
  'SLX-SLATE-PRO': '📱',
  'SLX-K230-DEVKIT': '🧪',
  'SLX-B2B-DONGLE-100': '📦',
  'SLX-B2B-WATCH-50': '🛡️',
  'SLX-B2B-SLATE-25': '🛰️',
  'SLX-RUGGED-GW-RACK': '📡',
  'SLX-HFS-ENT-SUITE': '🖥️',
};
const SKU_ICONS = ['🔌', '⌚', '📱', '🧪', '📦', '🛡️', '🛰️', '📡', '🖥️'];

const state = {
  busy: false,
  segment: 'all', // 'all' | 'b2b' | 'b2c'
  myFiat: 0,
  merchantFiat: 0,
  totalRev: 0,
  totalUnitsSold: 0,
  myUnitsBought: 0,
  myTotalSpent: 0,
  skus: [],
  sales: [],
  qtyDraft: new Map(), // productId -> qty
  skuMetaById: new Map(), // lower productId -> { name, fullName, tier, defaultOrderQty, specs, category, code }
  selectedGlSkuId: '',
  glMode: 'live_sku',
};

const el = {
  banner: document.getElementById('shopBanner'),
  bannerText: document.getElementById('shopBannerText'),
  bannerClose: document.getElementById('shopBannerClose'),
  myFiatHero: document.getElementById('myFiatHero'),
  myIdentityHero: document.getElementById('myIdentityHero'),
  btnTopUp5k: document.getElementById('btnTopUp5k'),
  btnTopUp25k: document.getElementById('btnTopUp25k'),
  btnTopUp250k: document.getElementById('btnTopUp250k'),
  chkShopAutoTopUp: document.getElementById('chkShopAutoTopUp'),
  catalogSegmentBar: document.getElementById('catalogSegmentBar'),
  kpiSkuCount: document.getElementById('kpiSkuCount'),
  kpiProdAddr: document.getElementById('kpiProdAddr'),
  kpiTotalRev: document.getElementById('kpiTotalRev'),
  kpiTotalSold: document.getElementById('kpiTotalSold'),
  kpiMerchantBal: document.getElementById('kpiMerchantBal'),
  kpiMySpent: document.getElementById('kpiMySpent'),
  kpiMyUnits: document.getElementById('kpiMyUnits'),
  productGrid: document.getElementById('productGrid'),
  shopGlModeBar: document.getElementById('shopGlModeBar'),
  shopGlSkuRow: document.getElementById('shopGlSkuRow'),
  shopGlSkuSelect: document.getElementById('shopGlSkuSelect'),
  shopGlPreviewMount: document.getElementById('shopGlPreviewMount'),
  salesFeedMeta: document.getElementById('salesFeedMeta'),
  salesTbody: document.getElementById('salesTbody'),
};

function showBanner(html, kind = 'info') {
  el.banner.className = `inst-banner show ${kind}`;
  el.bannerText.innerHTML = html;
}
el.bannerClose?.addEventListener('click', () => el.banner.classList.remove('show'));

let commerceWatcher = null;
const refreshCommerceState = createSingleFlightRefresh(_runRefreshCommerceStateInner);

const session = new SlxInstSession({
  activePage: 'commerce',
  title: 'SuperLexicon E-Commerce — Atomic DvP Checkout',
  subtitle: 'product_ledger.wasm + accounting_ledger.wasm + asset_ledger.wasm (SGD-FIAT)',
  appTitle: 'E-Commerce — ProductLedger + AccountingLedger + Fiat AssetLedger',
  onRefresh: refreshCommerceState,
  onIdentityLabelsUpdated: () => renderAll(),
  onSelectHfsEntry: async () => {
    commerceWatcher?.refreshFilter?.();
  },
});

async function _runRefreshCommerceStateInner(meta = null) {
  if (!session.online || !session.inst?.productLedger) {
    renderAll();
    return;
  }

  for (const p of session.inst.products || []) {
    state.skuMetaById.set(p.skuId.toLowerCase(), p);
  }

  const prod = session.inst.productLedger;
  const acc = session.inst.accountingLedger;
  const fiat = session.inst.fiatLedger;

  try {
    const [blkHex, catHex, revHex, unitsHex, saleCntHex, merchBal] = await Promise.all([
      meta && meta.blockNumber > 0 ? Promise.resolve(null) : session.rpcCall('eth_blockNumber'),
      session.ethCall(prod, encodeAbi('getCatalogSnapshot()')),
      session.ethCall(acc, encodeAbi('totalRevenue()')),
      session.ethCall(acc, encodeAbi('totalUnitsSold()')),
      session.ethCall(acc, encodeAbi('saleCount()')),
      session.getLedgerBalance(
        fiat,
        session.inst.treasuryIdentity || session.inst.merchantRevenueIdentity
      ),
    ]);

    session.blockNumber =
      meta && meta.blockNumber > 0 ? meta.blockNumber : Number(BigInt(blkHex));
    session.setNetStatus(`Subnet 1 Live • Block #${fmtNum(session.blockNumber)}`, true);

    const cat = decodeCatalogSnapshotHex(catHex);
    state.skus = cat.skus;
    state.totalRev = decodeUintWord(revHex);
    state.totalUnitsSold = decodeUintWord(unitsHex);
    state.merchantFiat = merchBal;

    if (session.myIdentityAddr) {
      const [myBal, myStatsHex] = await Promise.all([
        session.getLedgerBalance(fiat, session.myIdentityAddr),
        session.ethCall(
          acc,
          encodeAbi('buyerPurchasesOf(address)', [['address', session.myIdentityAddr]])
        ),
      ]);
      state.myFiat = myBal;
      const sb = hexToBytes(myStatsHex);
      if (sb.length >= 64) {
        state.myUnitsBought = readU64BE(sb, 24);
        state.myTotalSpent = readU64BE(sb, 56);
      }
    } else {
      state.myFiat = 0;
      state.myUnitsBought = 0;
      state.myTotalSpent = 0;
    }

    const saleCount = decodeUintWord(saleCntHex);
    const fromIdx = Math.max(0, saleCount - 16);
    const saleIdxs = [];
    for (let i = saleCount - 1; i >= fromIdx; i--) saleIdxs.push(i);
    const fetchedSales = await Promise.all(
      saleIdxs.map((idx) =>
        session
          .ethCall(acc, encodeAbi('getSale(uint64)', [['uint64', idx]]))
          .then((h) => {
            const s = decodeSaleRecordHex(h);
            return s ? { saleIdx: idx + 1, ...s } : null;
          })
          .catch(() => null)
      )
    );
    state.sales = fetchedSales.filter(Boolean);

    renderAll();
  } catch (e) {
    console.warn('Commerce poll warning:', e);
  }
}

function skuTierOf(sku, meta) {
  if (meta?.tier === 'b2b' || meta?.tier === 'b2c') return meta.tier;
  return sku.latestPrice >= 10000 ? 'b2b' : 'b2c';
}

function defaultQtyOf(sku, meta) {
  if (meta?.defaultOrderQty) return meta.defaultOrderQty;
  return skuTierOf(sku, meta) === 'b2b' ? 3 : 1;
}

const shopTweenMap = new WeakMap();
const shopPrevMetrics = new Map();

function fmtShopDelta(delta, suffix = 'SGD') {
  const abs = Math.abs(delta);
  const sign = delta >= 0 ? '+' : '−';
  const mag =
    abs >= 1_000_000
      ? `${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 100_000
        ? `${Math.round(abs / 1_000)}K`
        : abs >= 1_000
          ? `${(abs / 1_000).toFixed(1)}K`
          : fmtNum(Math.round(abs));
  return `${sign}${mag}${suffix ? ` ${suffix}` : ''}`;
}

function animateShopNum(elNode, targetVal) {
  if (!elNode) return;
  const ex = shopTweenMap.get(elNode);
  if (!ex || !Number.isFinite(ex.cur)) {
    shopTweenMap.set(elNode, { cur: targetVal, raf: 0 });
    elNode.textContent = `${fmtNum(Math.round(targetVal))} SGD`;
    return;
  }
  if (Math.abs(targetVal - ex.cur) < 1) {
    ex.cur = targetVal;
    elNode.textContent = `${fmtNum(Math.round(targetVal))} SGD`;
    return;
  }
  if (ex.raf) cancelAnimationFrame(ex.raf);
  const from = ex.cur;
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 580);
    const w = 1 - Math.pow(1 - t, 3);
    ex.cur = from + (targetVal - from) * w;
    elNode.textContent = `${fmtNum(Math.round(t >= 1 ? targetVal : ex.cur))} SGD`;
    ex.raf = t < 1 ? requestAnimationFrame(step) : 0;
  };
  ex.raf = requestAnimationFrame(step);
}

function trackShopKpiDelta(key, valEl, nextVal, suffix = 'SGD', toneOverride = null) {
  const cardEl = valEl?.closest('.inst-kpi');
  const hasPrev = shopPrevMetrics.has(key);
  const prev = shopPrevMetrics.get(key);
  shopPrevMetrics.set(key, nextVal);
  if (!hasPrev || !cardEl) return;
  const delta = nextVal - prev;
  if (Math.abs(delta) < 10) return;
  const tone = toneOverride || (delta >= 0 ? 'pos' : 'neg');
  const stackIdx = Math.min(2, cardEl.querySelectorAll('.inst-hud-float').length);
  const badge = document.createElement('span');
  badge.className = `inst-hud-float ${tone}`;
  badge.style.top = `${6 + stackIdx * 21}px`;
  badge.textContent = `${delta >= 0 ? '▲' : '▼'} ${fmtShopDelta(delta, suffix)}`;
  badge.addEventListener('animationend', () => badge.remove());
  cardEl.appendChild(badge);
}

function ensureSelectedGlSku() {
  if (state.selectedGlSkuId && state.skus.some((s) => s.productId === state.selectedGlSkuId)) {
    return;
  }
  const preferredB2b = state.skus.find(
    (s) => skuTierOf(s, state.skuMetaById.get(s.productId)) === 'b2b'
  );
  state.selectedGlSkuId = (preferredB2b || state.skus[0])?.productId || '';
}

function renderShopGlPreview() {
  if (!el.shopGlPreviewMount) return;
  ensureSelectedGlSku();

  if (el.shopGlModeBar) {
    el.shopGlModeBar.querySelectorAll('[data-gl-mode]').forEach((btn) => {
      btn.classList.toggle('primary', btn.getAttribute('data-gl-mode') === state.glMode);
    });
  }

  if (el.shopGlSkuRow) {
    el.shopGlSkuRow.style.display = state.glMode === 'live_sku' ? 'flex' : 'none';
  }

  if (el.shopGlSkuSelect && state.skus.length > 0) {
    el.shopGlSkuSelect.innerHTML = state.skus
      .map((sku) => {
        const meta = state.skuMetaById.get(sku.productId) || {};
        const tier = skuTierOf(sku, meta) === 'b2b' ? 'B2B' : 'B2C';
        const qty = state.qtyDraft.get(sku.productId) || defaultQtyOf(sku, meta);
        const label = `[${tier}] ${qty}× ${meta.fullName || sku.name} — ${fmtNum(qty * sku.latestPrice)} SGD`;
        const sel = sku.productId === state.selectedGlSkuId ? 'selected' : '';
        return `<option value="${sku.productId}" ${sel}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  if (state.glMode === 'live_sku') {
    const sku = state.skus.find((s) => s.productId === state.selectedGlSkuId);
    if (sku) {
      const meta = state.skuMetaById.get(sku.productId) || {};
      const qty = state.qtyDraft.get(sku.productId) || defaultQtyOf(sku, meta);
      const bp = buildLiveProductCheckoutPreview(sku, meta, qty);
      el.shopGlPreviewMount.innerHTML = renderHumanBlueprintHtml(bp);
      return;
    }
  }

  const archetype =
    GL_SCENARIO_BLUEPRINTS.find((b) => b.id === state.glMode) || GL_SCENARIO_BLUEPRINTS[1];
  if (archetype) {
    el.shopGlPreviewMount.innerHTML = renderHumanBlueprintHtml(archetype);
  }
}

function renderAll() {
  ensureSelectedGlSku();
  animateShopNum(el.myFiatHero, state.myFiat);
  el.myIdentityHero.textContent = session.myIdentityAddr
    ? `Account: ${session.myIdentityHandle}`
    : `Top up or click Buy to activate your account`;

  const b2bCount = state.skus.filter((s) => skuTierOf(s, state.skuMetaById.get(s.productId)) === 'b2b').length;
  const b2cCount = state.skus.length - b2bCount;
  el.kpiSkuCount.textContent = `${state.skus.length} Items`;
  el.kpiProdAddr.textContent = `${b2bCount} B2B Bulk • ${b2cCount} Retail`;
  animateShopNum(el.kpiTotalRev, state.totalRev);
  trackShopKpiDelta('totalRev', el.kpiTotalRev, state.totalRev, 'REV');
  el.kpiTotalSold.textContent = `${fmtNum(state.totalUnitsSold)} lots / units sold`;
  animateShopNum(el.kpiMerchantBal, state.merchantFiat);
  trackShopKpiDelta('merchantFiat', el.kpiMerchantBal, state.merchantFiat, 'CASH');
  animateShopNum(el.kpiMySpent, state.myTotalSpent);
  trackShopKpiDelta('mySpent', el.kpiMySpent, state.myTotalSpent, 'PAID', 'cyan');
  el.kpiMyUnits.textContent = `${fmtNum(state.myUnitsBought)} purchased`;

  if (el.catalogSegmentBar) {
    el.catalogSegmentBar.querySelectorAll('[data-cat-seg]').forEach((btn) => {
      const seg = btn.getAttribute('data-cat-seg');
      btn.classList.toggle('primary', seg === state.segment);
      if (seg === 'all') btn.textContent = `All (${state.skus.length})`;
      else if (seg === 'b2b') btn.textContent = `📦 B2B Bulk (${b2bCount})`;
      else if (seg === 'b2c') btn.textContent = `🛍️ Retail (${b2cCount})`;
    });
  }

  const visibleSkus = state.skus.filter((s) => {
    if (state.segment === 'all') return true;
    return skuTierOf(s, state.skuMetaById.get(s.productId)) === state.segment;
  });

  el.productGrid.innerHTML = visibleSkus
    .map((sku, idx) => {
      const meta = state.skuMetaById.get(sku.productId) || {};
      const tier = skuTierOf(sku, meta);
      const isB2b = tier === 'b2b';
      const qty = state.qtyDraft.get(sku.productId) || defaultQtyOf(sku, meta);
      const totalCost = qty * sku.latestPrice;
      const canAfford = state.myFiat >= totalCost || el.chkShopAutoTopUp.checked;
      const outOfStock = sku.unitsAvailable === 0;
      const icon = SKU_ICONS_BY_CODE[meta.code] || SKU_ICONS[idx % SKU_ICONS.length];
      const isPreviewed =
        state.glMode === 'live_sku' && state.selectedGlSkuId === sku.productId;

      return `
        <article class="sku-card" style="${isB2b ? 'border-color:rgba(245,158,11,0.3);background:rgba(15,23,42,0.92);' : ''}">
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:22px;">${icon}</span>
                <span class="inst-badge ${isB2b ? 'amber' : 'cyan'}">${isB2b ? 'B2B Bulk' : 'Retail'}</span>
              </div>
              ${
                outOfStock
                  ? `<span class="inst-badge red">Out of Stock</span>`
                  : `<span style="font-size:11.5px;color:#6ee7b7;font-family:var(--mono);">${fmtNum(sku.unitsAvailable)} in stock</span>`
              }
            </div>
            <div>
              <h4 style="margin:2px 0 4px;font-size:15.5px;font-weight:700;color:#f8fafc;">${escapeHtml(meta.fullName || sku.name)}</h4>
              ${
                meta.specs
                  ? `<div style="font-size:12px;color:#94a3b8;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;" title="${escapeHtml(meta.specs)}">${escapeHtml(meta.specs)}</div>`
                  : ''
              }
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:11px;margin-top:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div>
                <span class="sku-price">${fmtNum(sku.latestPrice)} SGD</span>
                <span style="font-size:11.5px;color:var(--txt-2);"> / ${isB2b ? 'lot' : 'unit'}</span>
              </div>
              <button
                type="button"
                class="inst-btn sm ${isPreviewed ? 'emerald' : ''}"
                data-preview-sku="${sku.productId}"
                style="padding:4px 9px;font-size:11px;"
              >
                📖 Preview Books
              </button>
            </div>

            <div style="display:flex;gap:8px;align-items:center;">
              <input
                type="number"
                class="inst-input"
                min="1"
                max="${Math.max(1, sku.unitsAvailable)}"
                value="${qty}"
                data-qty-sku="${sku.productId}"
                style="width:70px;text-align:center;"
                ${outOfStock ? 'disabled' : ''}
              />
              <button
                class="inst-btn ${canAfford ? 'emerald' : 'primary'}"
                data-buy-sku="${sku.productId}"
                style="flex:1;padding:9px 12px;"
                ${outOfStock ? 'disabled' : ''}
              >
                ${isB2b ? 'Procure' : 'Buy'} • ${fmtNum(totalCost)} SGD
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  renderShopGlPreview();

  el.salesFeedMeta.textContent = `${state.sales.length} recent sales`;
  el.salesTbody.innerHTML = state.sales.length
    ? state.sales
        .map((s) => {
          const meta = state.skuMetaById.get(s.productId) || {};
          const skuRow = state.skus.find((k) => k.productId === s.productId);
          const prodName = meta.name || skuRow?.name || meta.fullName || shortAddr(s.productId);
          const isB2b = (meta.tier || (s.unitPrice >= 10000 ? 'b2b' : 'b2c')) === 'b2b';
          return `
            <tr>
              <td>#${s.saleIdx}</td>
              <td>#${fmtNum(s.blockNumber)}</td>
              <td style="font-weight:600;color:var(--txt-0);">
                <span class="inst-badge ${isB2b ? 'amber' : 'cyan'}" style="margin-right:6px;">${isB2b ? 'B2B' : 'Retail'}</span>
                ${escapeHtml(prodName)}
              </td>
              <td>${escapeHtml(session.labelForIdentity(s.buyer))}</td>
              <td>${fmtNum(s.quantity)}×</td>
              <td style="text-align:right;color:${isB2b ? '#fbbf24' : '#6ee7b7'};font-weight:700;font-family:var(--mono);">${fmtNum(s.totalAmount)} SGD</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="6" style="color:var(--txt-2);">No sales recorded yet</td></tr>`;
}

async function handleTopUp(amount) {
  if (state.busy) return;
  state.busy = true;
  el.btnTopUp5k.disabled = true;
  el.btnTopUp25k.disabled = true;
  if (el.btnTopUp250k) el.btnTopUp250k.disabled = true;
  try {
    await session.requestFiatTopUp(amount, (msg) => showBanner(`⏳ ${escapeHtml(msg)}`, 'info'));
    await refreshCommerceState();
    showBanner(
      `✅ Credited <strong>+${fmtNum(amount)} SGD-FIAT</strong> into your <code>Identity</code> HFS on <code>AssetLedger</code>!`,
      'ok'
    );
  } catch (err) {
    showBanner(`🚫 Top-up error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
    el.btnTopUp5k.disabled = false;
    el.btnTopUp25k.disabled = false;
    if (el.btnTopUp250k) el.btnTopUp250k.disabled = false;
  }
}

el.btnTopUp5k.addEventListener('click', () => handleTopUp(5000));
el.btnTopUp25k.addEventListener('click', () => handleTopUp(50000));
el.btnTopUp250k?.addEventListener('click', () => handleTopUp(250000));
el.chkShopAutoTopUp.addEventListener('change', renderAll);

el.catalogSegmentBar?.addEventListener('click', (e) => {
  const segBtn = e.target.closest('[data-cat-seg]');
  if (!segBtn) return;
  state.segment = segBtn.getAttribute('data-cat-seg') || 'all';
  renderAll();
});

el.shopGlModeBar?.addEventListener('click', (e) => {
  const modeBtn = e.target.closest('[data-gl-mode]');
  if (!modeBtn) return;
  state.glMode = modeBtn.getAttribute('data-gl-mode') || 'live_sku';
  renderAll();
});

el.shopGlSkuSelect?.addEventListener('change', () => {
  state.selectedGlSkuId = el.shopGlSkuSelect.value;
  state.glMode = 'live_sku';
  renderAll();
});

document.addEventListener('input', (e) => {
  const inp = e.target.closest('[data-qty-sku]');
  if (inp) {
    const pid = inp.getAttribute('data-qty-sku');
    const q = Math.max(1, Math.floor(Number(inp.value) || 1));
    state.qtyDraft.set(pid, q);
    state.selectedGlSkuId = pid;
    state.glMode = 'live_sku';
    const sku = state.skus.find((s) => s.productId === pid);
    const card = inp.closest('.sku-card');
    if (sku && card) {
      const meta = state.skuMetaById.get(pid) || {};
      const isB2b = skuTierOf(sku, meta) === 'b2b';
      const totalCost = q * sku.latestPrice;
      const buyBtn = card.querySelector('[data-buy-sku]');
      if (buyBtn) {
        buyBtn.textContent = `${isB2b ? 'Procure' : 'Buy'} • ${fmtNum(totalCost)} SGD`;
      }
      card.querySelectorAll('[data-preset-qty]').forEach((b) => {
        b.classList.toggle('primary', Number(b.getAttribute('data-preset-qty')) === q);
      });
    }
    renderShopGlPreview();
  }
});

document.addEventListener('click', async (e) => {
  const previewBtn = e.target.closest('[data-preview-sku]');
  if (previewBtn) {
    state.selectedGlSkuId = previewBtn.getAttribute('data-preview-sku');
    state.glMode = 'live_sku';
    renderAll();
    document.getElementById('shopGlSection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const presetBtn = e.target.closest('[data-preset-sku]');
  if (presetBtn) {
    const pid = presetBtn.getAttribute('data-preset-sku');
    const q = Math.max(1, Number(presetBtn.getAttribute('data-preset-qty')) || 1);
    state.qtyDraft.set(pid, q);
    state.selectedGlSkuId = pid;
    state.glMode = 'live_sku';
    renderAll();
    return;
  }

  const buyBtn = e.target.closest('[data-buy-sku]');
  if (!buyBtn || state.busy) return;
  const pid = buyBtn.getAttribute('data-buy-sku');
  state.selectedGlSkuId = pid;
  state.glMode = 'live_sku';
  const sku = state.skus.find((s) => s.productId === pid);
  if (!sku) return;

  const meta = state.skuMetaById.get(pid) || {};
  const qty = Math.max(1, state.qtyDraft.get(pid) || defaultQtyOf(sku, meta));
  const totalCost = qty * sku.latestPrice;

  state.busy = true;
  buyBtn.disabled = true;
  try {
    const myId = await session.ensureMyIdentity((msg) => showBanner(`⏳ ${escapeHtml(msg)}`, 'info'));
    const curBal = await session.getLedgerBalance(session.inst.fiatLedger, myId);
    if (curBal < totalCost && el.chkShopAutoTopUp.checked) {
      const topUpAmt = Math.max(10000, totalCost - curBal + 2500);
      await session.requestFiatTopUp(topUpAmt, (msg) =>
        showBanner(`💧 Auto-Top-Up: ${escapeHtml(msg)}`, 'info')
      );
    }

    showBanner(
      `🛒 Signing <code>Identity.buyProduct(${escapeHtml(sku.name)}, qty=${qty})</code> (${fmtNum(totalCost)} SGD)…`,
      'info'
    );
    await session.sendAsMyIdentity(
      encodeAbi('buyProduct(address,bytes32,uint64)', [
        ['address', session.inst.productLedger],
        ['bytes32', pid],
        ['uint64', qty],
      ]),
      `buyProduct(${qty}x)`,
      'ProductLedger'
    );

    await refreshCommerceState();
    showBanner(
      `✅ <strong>Purchased ${qty}× ${escapeHtml(sku.name)} (${fmtNum(totalCost)} SGD)!</strong> Stock decremented on <code>ProductLedger</code>, <code>SGD-FIAT</code> settled to Merchant Vault, and sale logged in <code>AccountingLedger</code>!`,
      'ok'
    );
  } catch (err) {
    await refreshCommerceState();
    const needTopUp = state.myFiat < totalCost;
    showBanner(
      needTopUp
        ? `🚫 <strong>Insufficient SGD-FIAT Balance (${fmtNum(state.myFiat)} &lt; ${fmtNum(totalCost)} SGD)!</strong> Click <strong>💧 Request +25,000 SGD Top-Up</strong> above and try again.`
        : `🚫 Purchase reverted on Wasmtime: ${escapeHtml(err.message)}`,
      'err'
    );
  } finally {
    state.busy = false;
    buyBtn.disabled = false;
  }
});

renderShopGlPreview();
await session.boot();
commerceWatcher = slxWatchChainApp({
  rpcUrl: () => session.rpcUrl,
  filter: () => {
    const addrs = [session.inst?.productLedger, session.inst?.accountingLedger].filter(Boolean);
    return { address: addrs };
  },
  onLog: (lg) => {
    if (!lg.isBackfill) {
      commerceWatcher?.triggerRefresh?.({ source: 'log', blockNumber: lg.blockNumberNum });
    }
  },
  onRefresh: (meta) => refreshCommerceState(meta),
});
