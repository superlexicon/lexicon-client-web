/**
 * SuperLexicon Multi-Market Institutional Exchange & Discrete-Time FIFO CLOB (`/dex.html`)
 *
 * Views:
 *  1. Exchange Markets Directory (`viewMode = 'listings'`, default at `/dex.html`)
 *     - Live table of all active `DEX_CLOB` markets registered in `HfsRegistry`
 *     - Real-time clearing prices `P*`, % trend & inline SVG sparklines, Best Bid × Best Ask,
 *       visual Bid/Ask depth bars, Next-Block Pending Intake badges, and `+ List New Market` CTA.
 *  2. Individual Market Trading Terminal (`viewMode = 'trading'`, opened on click or `?hfs=0x...`)
 *     - Full dynamic CLOB view parameterized by each listing's exact `<baseSymbol> / <quoteSymbol>`
 *     - Live `BlockMatched` multi-block price & volume chart, flashing AVL Bid/Ask ladders,
 *       live order tape, faucet, and secp256k1-signed limit / crossing order ticket.
 */

import {
  SlxInstSession,
  GOV_CONSTANTS,
  ZERO_ADDR,
  encodeAbi,
  decodeUintWord,
  decodeAddrWord,
  readU64BE,
  decodeDexOrderHex,
  decodeBookDepthHex,
  decodeBestBidAskHex,
  decodeLastMatchSummaryHex,
  decodeBlockMatchedLog,
  shortAddr,
  fmtNum,
  escapeHtml,
} from '@superlexicon/sdk/inst-suite';
import {
  IFRS_VALUATION_TOPICS,
  decodeIfrsStatementsHex,
  computeTriangulatedValuation,
} from '@superlexicon/sdk/ifrs-valuation';
import {
  hexToBytes,
  fetchRegisteredHfsByType,
  getUrlHfsParam,
  setUrlHfsParam,
  clearUrlHfsParam,
  slxWatchChainApp,
  createSingleFlightRefresh,
} from '@superlexicon/sdk';

const initialHfs = getUrlHfsParam();

const state = {
  viewMode: initialHfs ? 'trading' : 'listings', // 'listings' | 'trading'
  categoryFilter: 'all', // 'all' | 'equity' | 'commodities' | 'compute' | 'futures'
  searchQuery: '',
  side: 'bid', // 'bid' | 'ask'
  busy: false,
  pollInFlight: false,

  // Multi-market directory state
  listings: [], // Array of HfsRegistry entries
  lastRegistryRefreshBlock: 0,
  lastScannedMatchBlock: 0,
  statsByDex: new Map(), // dexAddr -> { entry, depth, bestBid, bestAsk, lastMatch, orderCount, history, latestPrice, pctChange, totalVol, totalNotional }
  historyByDex: new Map(), // dexAddr -> [{ block, price, volume, filledBids, filledAsks }]
  prevPriceByDex: new Map(), // dexAddr -> number
  flashByDex: new Map(), // dexAddr -> { dir: 'up' | 'down', until: ms }
  dexTxsByBlock: new Map(), // blockNum -> { txSet: Set<txHash>, ts: number, isBackfill: boolean }
  tpsSamples: [], // [{ ts, blk, cumOrders, cumClears }]
  liveDexTps: 0,
  liveTxsPerBlock: 0,

  // Active trading terminal state
  myFiat: 0,
  myShare: 0,
  faucetHasBase: true,
  bestBid: 0,
  bestAsk: 0,
  depth: { pendingCount: 0, bidCount: 0, askCount: 0 },
  lastMatch: { lastMatchBlock: 0, clearingPrice: 0, matchedVolume: 0, filledBids: 0, filledAsks: 0 },
  bids: [],
  asks: [],
  recentOrders: [],
  matchHistory: [],
  priceInitForDex: '',
  prevBookLevels: new Map(), // `${dex}:bid:${px}` -> qty
  bookFlashUntil: new Map(), // `${dex}:bid:${px}` -> { dir, until }

  // Pure on-chain MEV forensics state
  mevHistoryByDex: new Map(), // dexAddr -> Map(blockNumber -> exploitObj)
  mevRoleByOrderId: new Map(), // orderId -> { badge, cls, rowCls }
  selectedMevBlock: 0,
  mevPermIdx: 0, // 0 = Bot->Victim->Back, 1 = Victim->Bot->Back, 2 = Back->Victim->Bot

  // Live IAS / IFRS Fundamental Valuation linkage (`DexClob` <-> `CorporateCharter` <-> `AccountingLedger`)
  ifrsByDex: new Map(), // dexAddr -> { accountingLedger, corporateCharter, totalShares, sharesBlk, stmt }
  charterByShareLedger: new Map(), // shareLedger -> corporateCharter
  charterToAccountingMap: new Map(), // corporateCharter -> accountingLedger
};

const el = {
  banner: document.getElementById('dexBanner'),
  bannerText: document.getElementById('dexBannerText'),
  bannerClose: document.getElementById('dexBannerClose'),

  // Views
  marketsView: document.getElementById('dexMarketsView'),
  tradingView: document.getElementById('dexTradingView'),

  // Exchange Directory View elements
  btnOpenListMarketModal: document.getElementById('btnOpenListMarketModal'),
  mktKpiCount: document.getElementById('mktKpiCount'),
  mktKpiCountSub: document.getElementById('mktKpiCountSub'),
  mktKpiVol: document.getElementById('mktKpiVol'),
  mktKpiVolSub: document.getElementById('mktKpiVolSub'),
  mktKpiDepth: document.getElementById('mktKpiDepth'),
  mktKpiDepthSub: document.getElementById('mktKpiDepthSub'),
  mktKpiTrades: document.getElementById('mktKpiTrades'),
  mktKpiTradesSub: document.getElementById('mktKpiTradesSub'),
  mktKpiBlock: document.getElementById('mktKpiBlock'),
  mktKpiBlockSub: document.getElementById('mktKpiBlockSub'),
  dexFilterPills: document.getElementById('dexFilterPills'),
  inpMarketSearch: document.getElementById('inpMarketSearch'),
  marketsTbody: document.getElementById('marketsTbody'),

  // Trading Terminal Topbar
  btnBackToMarkets: document.getElementById('btnBackToMarkets'),
  activeMarketIcon: document.getElementById('activeMarketIcon'),
  activeMarketPairTitle: document.getElementById('activeMarketPairTitle'),
  activeMarketCategoryBadge: document.getElementById('activeMarketCategoryBadge'),
  activeMarketNameSub: document.getElementById('activeMarketNameSub'),
  quickMarketsStrip: document.getElementById('quickMarketsStrip'),

  // Trading Terminal KPIs & Orderbook
  kpiPairVal: document.getElementById('kpiPairVal'),
  kpiDexAddr: document.getElementById('kpiDexAddr'),
  kpiLastPriceCard: document.getElementById('kpiLastPriceCard'),
  kpiLastPrice: document.getElementById('kpiLastPrice'),
  kpiLastBlock: document.getElementById('kpiLastBlock'),
  kpiLastVol: document.getElementById('kpiLastVol'),
  kpiLastFills: document.getElementById('kpiLastFills'),
  kpiSpread: document.getElementById('kpiSpread'),
  kpiSpreadSub: document.getElementById('kpiSpreadSub'),
  kpiMyFiat: document.getElementById('kpiMyFiat'),
  kpiMyShare: document.getElementById('kpiMyShare'),
  dexIfrsValuationBar: document.getElementById('dexIfrsValuationBar'),
  dexIfrsValuationBody: document.getElementById('dexIfrsValuationBody'),
  pendingIntakeBadge: document.getElementById('pendingIntakeBadge'),
  simMatcherBadge: document.getElementById('simMatcherBadge'),
  blockChartWrap: document.getElementById('blockChartWrap'),
  blockHistoryPills: document.getElementById('blockHistoryPills'),
  mevBotStatusBadge: document.getElementById('mevBotStatusBadge'),
  mevKpiAttempts: document.getElementById('mevKpiAttempts'),
  mevKpiAttemptsSub: document.getElementById('mevKpiAttemptsSub'),
  mevKpiSaved: document.getElementById('mevKpiSaved'),
  mevKpiSavedSub: document.getElementById('mevKpiSavedSub'),
  mevKpiExtracted: document.getElementById('mevKpiExtracted'),
  mevFeaturedWrap: document.getElementById('mevFeaturedWrap'),
  mevAttackHistoryPills: document.getElementById('mevAttackHistoryPills'),
  bidsCardTitle: document.getElementById('bidsCardTitle'),
  bidBookMeta: document.getElementById('bidBookMeta'),
  bidsPriceTh: document.getElementById('bidsPriceTh'),
  bidsQtyTh: document.getElementById('bidsQtyTh'),
  bidsTotalTh: document.getElementById('bidsTotalTh'),
  bidsTbody: document.getElementById('bidsTbody'),
  asksCardTitle: document.getElementById('asksCardTitle'),
  askBookMeta: document.getElementById('askBookMeta'),
  asksPriceTh: document.getElementById('asksPriceTh'),
  asksQtyTh: document.getElementById('asksQtyTh'),
  asksTotalTh: document.getElementById('asksTotalTh'),
  asksTbody: document.getElementById('asksTbody'),
  recentOrdersTbody: document.getElementById('recentOrdersTbody'),

  // Faucet & Order Form
  faucetSymbolsBadge: document.getElementById('faucetSymbolsBadge'),
  btnFaucetFiat: document.getElementById('btnFaucetFiat'),
  btnFaucetShare: document.getElementById('btnFaucetShare'),
  faucetFuturesNote: document.getElementById('faucetFuturesNote'),
  chkAutoTopUp: document.getElementById('chkAutoTopUp'),
  tabSideBid: document.getElementById('tabSideBid'),
  tabSideAsk: document.getElementById('tabSideAsk'),
  btnCrossBest: document.getElementById('btnCrossBest'),
  btnJoinBest: document.getElementById('btnJoinBest'),
  dexOrderForm: document.getElementById('dexOrderForm'),
  lblOrderPrice: document.getElementById('lblOrderPrice'),
  inpOrderPrice: document.getElementById('inpOrderPrice'),
  lblOrderQty: document.getElementById('lblOrderQty'),
  inpOrderQty: document.getElementById('inpOrderQty'),
  orderEscrowLabel: document.getElementById('orderEscrowLabel'),
  orderEscrowVal: document.getElementById('orderEscrowVal'),
  btnSubmitOrder: document.getElementById('btnSubmitOrder'),
};

function showBanner(html, kind = 'info') {
  el.banner.className = `inst-banner show ${kind}`;
  el.bannerText.innerHTML = html;
}
el.bannerClose?.addEventListener('click', () => el.banner.classList.remove('show'));

function classifyMarket(entry) {
  const m = entry?.meta || {};
  const baseSymbol =
    m.baseSymbol ||
    String(entry?.label || 'NVDAX-EQ')
      .split('/')[0]
      .trim()
      .split(/\s+/)
      .pop() ||
    'NVDAX-EQ';
  const quoteSymbol = m.quoteSymbol || 'SGD-FIAT';
  const quoteShort = quoteSymbol.replace(/-FIAT|-CASH|-SETTLE/i, '') || 'SGD';
  const up = `${entry?.label || ''} ${baseSymbol} ${m.category || ''}`.toUpperCase();

  let cat = 'equity';
  let badge = 'SPOT EQUITY';
  let badgeCls = 'green';
  let icon = '📈';

  if (up.includes('SGS-10Y') || up.includes('BOND') || up.includes('TREASURY') || up.includes('FIXED')) {
    cat = 'futures';
    badge = 'SOVEREIGN BOND';
    badgeCls = 'amber';
    icon = '🏛️';
  } else if (up.includes('DEIC') || up.includes('PERM')) {
    cat = 'futures';
    badge = 'PERP DERIVATIVE';
    badgeCls = 'amber';
    icon = '📜';
  } else if (up.includes('FUT')) {
    cat = 'futures';
    badge = 'CORP FUTURES';
    badgeCls = 'amber';
    icon = '⚓';
  } else if (up.includes('BRENT') || up.includes('OIL') || up.includes('ENERGY')) {
    cat = 'commodities';
    badge = 'ENERGY CMDTY';
    badgeCls = 'amber';
    icon = '🛢️';
  } else if (up.includes('XAU') || up.includes('GOLD') || up.includes('SILVER')) {
    cat = 'commodities';
    badge = 'PRECIOUS METAL';
    badgeCls = 'amber';
    icon = '🥇';
  } else if (up.includes('LITH') || up.includes('BATTERY') || up.includes('COBALT')) {
    cat = 'commodities';
    badge = 'BATTERY METAL';
    badgeCls = 'amber';
    icon = '🔋';
  } else if (up.includes('VOC') || up.includes('SPICE') || up.includes('CARGO') || up.includes('COMMOD')) {
    cat = 'commodities';
    badge = 'MARITIME CARGO';
    badgeCls = 'amber';
    icon = '🚢';
  } else if (up.includes('H100') || up.includes('GPU')) {
    cat = 'compute';
    badge = 'GPU CLUSTER';
    badgeCls = 'cyan';
    icon = '🖥️';
  } else if (up.includes('LEO') || up.includes('SPEC') || up.includes('RF')) {
    cat = 'compute';
    badge = 'RF SPECTRUM';
    badgeCls = 'cyan';
    icon = '🛰️';
  } else if (up.includes('QTM') || up.includes('COMPUTE') || up.includes('AI')) {
    cat = 'compute';
    badge = 'QUANTUM & AI';
    badgeCls = 'cyan';
    icon = '🧠';
  } else if (up.includes('SEMI') || up.includes('APEX')) {
    cat = 'equity';
    badge = 'SEMICONDUCTOR';
    badgeCls = 'cyan';
    icon = '🔬';
  } else if (up.includes('BIO') || up.includes('HELIO')) {
    cat = 'equity';
    badge = 'BIOTECH EQ';
    badgeCls = 'green';
    icon = '🧬';
  } else if (up.includes('BANK') || up.includes('FIN')) {
    cat = 'equity';
    badge = 'FINANCIALS';
    badgeCls = 'green';
    icon = '🏦';
  } else if (up.includes('REIT') || up.includes('STRAITS')) {
    cat = 'equity';
    badge = 'MARITIME REIT';
    badgeCls = 'green';
    icon = '🏗️';
  } else if (up.includes('TECH')) {
    cat = 'equity';
    badge = 'GROWTH EQUITY';
    badgeCls = 'cyan';
    icon = '⚡';
  }

  return {
    baseSymbol,
    quoteSymbol,
    quoteShort,
    pair: m.pair || `${baseSymbol} / ${quoteSymbol}`,
    cat,
    badge,
    badgeCls,
    icon,
    displayName: entry?.label || `${baseSymbol} / ${quoteSymbol} CLOB`,
  };
}

function getActiveMarketMeta() {
  const activeAddr = (session?.inst?.dexClob || '').toLowerCase();
  const entry =
    session?.activeHfsEntry ||
    state.listings.find((it) => it.primaryAddr === activeAddr) || {
      primaryAddr: activeAddr,
      label: 'Nvidya NVDAX-EQ / SGD-FIAT CLOB [SIM-BOT]',
      meta: { baseSymbol: 'NVDAX-EQ', quoteSymbol: 'SGD-FIAT' },
    };
  return classifyMarket(entry);
}

function loadSavedHistoryForDex(dexAddr) {
  const low = dexAddr.toLowerCase();
  if (state.historyByDex.has(low)) return state.historyByDex.get(low);
  const byBlk = new Map();
  if (
    session?.baseInst?.dexClob &&
    low === session.baseInst.dexClob.toLowerCase() &&
    Array.isArray(session.baseInst.seededMatchHistory)
  ) {
    for (const s of session.baseInst.seededMatchHistory) {
      if (s && s.block > 0 && s.volume > 0) {
        byBlk.set(s.block, {
          block: s.block,
          price: s.price,
          volume: s.volume,
          filledBids: s.filledBids || 1,
          filledAsks: s.filledAsks || 1,
        });
      }
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = JSON.parse(localStorage.getItem(`slx_dex_matches_${low}`) || '[]');
      for (const m of saved) {
        if (m && m.block > 0 && m.volume > 0) byBlk.set(m.block, m);
      }
    } catch (_) {}
  }
  const arr = Array.from(byBlk.values())
    .sort((a, b) => a.block - b.block)
    .slice(-28);
  state.historyByDex.set(low, arr);
  return arr;
}

function recordMatchIntoDexHistory(dexAddr, matchObj) {
  if (!dexAddr || !matchObj || !(matchObj.block > 0) || !(matchObj.volume > 0)) return;
  const low = dexAddr.toLowerCase();
  const cur = loadSavedHistoryForDex(low);
  const byBlk = new Map(cur.map((x) => [x.block, x]));
  byBlk.set(matchObj.block, {
    block: matchObj.block,
    price: matchObj.price,
    volume: matchObj.volume,
    filledBids: matchObj.filledBids || 1,
    filledAsks: matchObj.filledAsks || 1,
  });
  const next = Array.from(byBlk.values())
    .sort((a, b) => a.block - b.block)
    .slice(-28);
  state.historyByDex.set(low, next);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`slx_dex_matches_${low}`, JSON.stringify(next));
    } catch (_) {}
  }
}

const refreshDexState = createSingleFlightRefresh(_runRefreshDexStateInner);

const session = new SlxInstSession({
  activePage: 'dex',
  title: 'SuperLexicon Exchange — Multi-Market FIFO CLOB',
  subtitle: 'dex_clob.wasm (AVL Price-Level Tree + O(1) Queues) • Multi-Listing AssetLedger Settlement',
  appTitle: 'SuperLexicon Exchange — Multi-Market DEX CLOB',
  onRefresh: refreshDexState,
  onIdentityLabelsUpdated: () => renderAll(),
  onSelectHfsEntry: async (entry) => {
    if (entry?.primaryAddr) {
      state.viewMode = 'trading';
      state.priceInitForDex = '';
      syncViewVisibility();
    }
  },
});

function syncViewVisibility() {
  if (state.viewMode === 'listings') {
    el.marketsView.style.display = 'flex';
    el.tradingView.style.display = 'none';
  } else {
    el.marketsView.style.display = 'none';
    el.tradingView.style.display = 'flex';
  }
}

async function openMarketTradingView(entry, { pushHistory = true } = {}) {
  if (!entry) return;
  state.viewMode = 'trading';
  state.priceInitForDex = '';
  syncViewVisibility();
  setUrlHfsParam(entry.primaryAddr, pushHistory);
  session.hfsDropdown?.setSelectedAddr?.(entry.primaryAddr);
  await session.applySelectedHfsEntry(entry, { skipRefresh: true });
  await refreshDexState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openMarketsDirectoryView({ pushHistory = true } = {}) {
  state.viewMode = 'listings';
  syncViewVisibility();
  clearUrlHfsParam(pushHistory);
  renderAll();
}

window.addEventListener('popstate', async () => {
  const hfs = getUrlHfsParam();
  if (!hfs) {
    state.viewMode = 'listings';
    syncViewVisibility();
    renderAll();
  } else {
    const found = state.listings.find((it) => it.primaryAddr === hfs);
    state.viewMode = 'trading';
    state.priceInitForDex = '';
    syncViewVisibility();
    if (found) {
      session.hfsDropdown?.setSelectedAddr?.(found.primaryAddr);
      await session.applySelectedHfsEntry(found, { skipRefresh: true });
    }
    await refreshDexState();
  }
});

el.btnBackToMarkets?.addEventListener('click', () => {
  openMarketsDirectoryView({ pushHistory: true });
});

el.btnOpenListMarketModal?.addEventListener('click', () => {
  if (session.hfsDropdown?.openDeployModal) {
    session.hfsDropdown.openDeployModal();
  }
});

el.dexFilterPills?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  state.categoryFilter = btn.getAttribute('data-cat') || 'all';
  el.dexFilterPills.querySelectorAll('.dex-filter-pill').forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
  renderMarketsDirectory();
});

el.inpMarketSearch?.addEventListener('input', () => {
  state.searchQuery = String(el.inpMarketSearch.value || '').trim().toLowerCase();
  renderMarketsDirectory();
});

let _dexRenderQueued = false;
function scheduleDexRender() {
  if (_dexRenderQueued) return;
  _dexRenderQueued = true;
  Promise.resolve().then(() => {
    _dexRenderQueued = false;
    renderAll();
  });
}

function ingestDexSubscriptionLog(lg) {
  if (!lg) return;
  const blk = lg.blockNumberNum || 0;
  const txHash = lg.transactionHash || '';
  if (blk > 0 && txHash) {
    let rec = state.dexTxsByBlock.get(blk);
    if (!rec) {
      rec = { txSet: new Set(), ts: Date.now(), isBackfill: Boolean(lg.isBackfill) };
      state.dexTxsByBlock.set(blk, rec);
      if (state.dexTxsByBlock.size > 36) {
        const oldestKey = state.dexTxsByBlock.keys().next().value;
        if (oldestKey !== undefined) state.dexTxsByBlock.delete(oldestKey);
      }
    } else if (!lg.isBackfill && rec.isBackfill) {
      rec.isBackfill = false;
      rec.ts = Date.now();
    }
    rec.txSet.add(txHash);
  }

  const t0 = String(lg.topics?.[0] || '').toLowerCase();
  if (t0 === GOV_CONSTANTS.TOPIC_BLOCK_MATCHED.toLowerCase()) {
    const emitter = String(lg.address || '').toLowerCase();
    const decoded = decodeBlockMatchedLog(lg);
    if (emitter && decoded && decoded.volume > 0) {
      if (!lg.isBackfill) {
        const prevPx = state.prevPriceByDex.get(emitter);
        if (prevPx && decoded.price && decoded.price !== prevPx) {
          state.flashByDex.set(emitter, {
            dir: decoded.price > prevPx ? 'up' : 'down',
            until: Date.now() + 1450,
          });
        }
        if (decoded.price > 0) {
          state.prevPriceByDex.set(emitter, decoded.price);
        }
      }
      recordMatchIntoDexHistory(emitter, decoded);
      if (blk > state.lastScannedMatchBlock) {
        state.lastScannedMatchBlock = blk;
      }
      if (!lg.isBackfill) {
        scheduleDexRender();
      }
    }
    return;
  }

  // Live IAS / IFRS AccountingLedger Event Hook: immediately refresh intrinsic fair value on new bookings!
  if (
    !lg.isBackfill &&
    (t0 === IFRS_VALUATION_TOPICS.JOURNAL_POSTED ||
      t0 === IFRS_VALUATION_TOPICS.SUBLEDGER_UPDATED ||
      t0 === IFRS_VALUATION_TOPICS.PERIOD_CLOSED)
  ) {
    const emitter = String(lg.address || '').toLowerCase();
    for (const [, rec] of state.ifrsByDex.entries()) {
      if (rec.accountingLedger === emitter) {
        session
          .ethCall(emitter, encodeAbi('getFinancialStatements()'))
          .then((hex) => {
            const stmt = decodeIfrsStatementsHex(hex);
            if (stmt) {
              rec.stmt = stmt;
              scheduleDexRender();
            }
          })
          .catch(() => {});
      }
    }
  }
}

async function refreshIfrsValuationsForListings(curBlk, refreshRegistry = false) {
  if (!session.online) return;
  try {
    if (refreshRegistry || state.charterToAccountingMap.size === 0) {
      if (session.baseInst?.corporateCharter && session.baseInst?.accountingLedger) {
        state.charterToAccountingMap.set(
          session.baseInst.corporateCharter.toLowerCase(),
          session.baseInst.accountingLedger.toLowerCase()
        );
      }
      const sec = session.manifest?.ifrsAccounting?.secondaryCompany;
      if (sec?.corporateCharter && sec?.accountingLedger) {
        state.charterToAccountingMap.set(
          sec.corporateCharter.toLowerCase(),
          sec.accountingLedger.toLowerCase()
        );
      }
      const regAddr = session.manifest?.hfsRegistry || '';
      if (regAddr) {
        const ifrsEntries = await fetchRegisteredHfsByType('IFRS_LEDGER', {
          rpcUrl: session.rpcUrl,
          registryAddr: regAddr,
        }).catch(() => []);
        for (const it of ifrsEntries) {
          const chr = (it.meta?.corporateCharter || it.meta?.chr || '').toLowerCase();
          if (chr && chr !== ZERO_ADDR && it.primaryAddr) {
            state.charterToAccountingMap.set(chr, it.primaryAddr.toLowerCase());
          }
        }
      }
    }

    const baseDex = (session.baseInst?.dexClob || '').toLowerCase();
    await Promise.all(
      state.listings.map(async (entry) => {
        const dexAddr = entry.primaryAddr.toLowerCase();
        const info = classifyMarket(entry);
        if (info.cat !== 'equity' && dexAddr !== baseDex) return;

        let chr = '';
        let acc = '';
        if (dexAddr === baseDex && session.baseInst?.accountingLedger) {
          chr = (session.baseInst.corporateCharter || '').toLowerCase();
          acc = session.baseInst.accountingLedger.toLowerCase();
        } else {
          const shLed = (entry.meta?.shareLedger || '').toLowerCase();
          if (shLed && shLed !== ZERO_ADDR) {
            if (state.charterByShareLedger.has(shLed)) {
              chr = state.charterByShareLedger.get(shLed);
            } else {
              const chrHex = await session
                .ethCall(shLed, encodeAbi('associatedCharter()'))
                .catch(() => '0x');
              chr = decodeAddrWord(chrHex);
              state.charterByShareLedger.set(shLed, chr);
            }
            if (chr && chr !== ZERO_ADDR) {
              acc = state.charterToAccountingMap.get(chr) || '';
            }
          }
        }

        if (!acc || acc === ZERO_ADDR) return;

        const prev = state.ifrsByDex.get(dexAddr);
        const needShares = !prev || !prev.totalShares || curBlk - (prev.sharesBlk || 0) >= 12;
        const [stmtHex, totHex] = await Promise.all([
          session.ethCall(acc, encodeAbi('getFinancialStatements()')).catch(() => '0x'),
          needShares && chr && chr !== ZERO_ADDR
            ? session
                .ethCall(chr, encodeAbi('convertedCommonTotals(address)', [['address', ZERO_ADDR]]))
                .catch(() => '0x')
            : Promise.resolve('0x'),
        ]);
        const stmt = decodeIfrsStatementsHex(stmtHex) || prev?.stmt || null;
        if (!stmt) return;
        let totalShares = prev?.totalShares || 0;
        if (totHex && totHex !== '0x') {
          const tb = hexToBytes(totHex);
          if (tb.length >= 64) totalShares = readU64BE(tb, 56);
        }
        state.ifrsByDex.set(dexAddr, {
          accountingLedger: acc,
          corporateCharter: chr,
          totalShares,
          sharesBlk: needShares ? curBlk : prev?.sharesBlk || curBlk,
          stmt,
        });
      })
    );
  } catch (_) {}
}

async function _runRefreshDexStateInner(meta = null) {
  if (!session.online || !session.inst) {
    syncViewVisibility();
    renderAll();
    return;
  }
  if (state.pollInFlight) return;
  state.pollInFlight = true;

  try {
    const curBlk =
      meta && meta.blockNumber > 0
        ? meta.blockNumber
        : Number(BigInt(await session.rpcCall('eth_blockNumber')));
    session.blockNumber = curBlk;
    session.setNetStatus(`Subnet 1 Live • Block #${fmtNum(curBlk)}`, true);

    // 1. Refresh registered `DEX_CLOB` listings from `HfsRegistry` on boot & every 6 blocks
    const shouldRefreshRegistry =
      !state.listings.length || curBlk - state.lastRegistryRefreshBlock >= 6;
    if (shouldRefreshRegistry) {
      const regAddr = session.manifest?.hfsRegistry || '';
      const fetched = await fetchRegisteredHfsByType('DEX_CLOB', {
        rpcUrl: session.rpcUrl,
        registryAddr: regAddr,
      }).catch(() => []);
      if (fetched.length) {
        state.listings = fetched;
        state.lastRegistryRefreshBlock = curBlk;
      } else if (!state.listings.length && session.baseInst?.dexClob) {
        state.listings = [
          {
            entryIdx: 0,
            status: 1,
            primaryAddr: session.baseInst.dexClob.toLowerCase(),
            label: 'Nvidya NVDAX-EQ / SGD-FIAT CLOB [SIM-BOT]',
            meta: {
              pair: 'NVDAX-EQ / SGD-FIAT',
              baseSymbol: 'NVDAX-EQ',
              quoteSymbol: 'SGD-FIAT',
              shareLedger: session.baseInst.shareLedger,
              fiatLedger: session.baseInst.fiatLedger,
              dexEscrowIdentity: session.baseInst.dexEscrowIdentity,
            },
          },
        ];
      }

      // Ensure URL `?hfs=` deep-link selects the matching listing entry
      const urlHfs = getUrlHfsParam();
      if (urlHfs) {
        const matched = state.listings.find((it) => it.primaryAddr === urlHfs);
        if (
          matched &&
          (!session.activeHfsEntry || session.activeHfsEntry.primaryAddr !== matched.primaryAddr)
        ) {
          await session.applySelectedHfsEntry(matched, { skipRefresh: true });
        }
      } else if (!session.activeHfsEntry && state.listings.length) {
        await session.applySelectedHfsEntry(state.listings[0], { skipRefresh: true });
      }
    }

    // 2. Poll lightweight summary state across ALL listed DEX markets in parallel
    await Promise.all(
      state.listings.map(async (entry) => {
        const addr = entry.primaryAddr.toLowerCase();
        try {
          const [depthHex, bestHex, summaryHex, ordCntHex] = await Promise.all([
            session.ethCall(addr, encodeAbi('bookDepth()')),
            session.ethCall(addr, encodeAbi('bestBidAndAsk()')),
            session.ethCall(addr, encodeAbi('lastMatchSummary()')),
            session.ethCall(addr, encodeAbi('orderCount()')),
          ]);
          const depth = decodeBookDepthHex(depthHex);
          const best = decodeBestBidAskHex(bestHex);
          const lastMatch = decodeLastMatchSummaryHex(summaryHex);
          const orderCount = decodeUintWord(ordCntHex);

          if (lastMatch.lastMatchBlock > 0 && lastMatch.matchedVolume > 0) {
            recordMatchIntoDexHistory(addr, {
              block: lastMatch.lastMatchBlock,
              price: lastMatch.clearingPrice,
              volume: lastMatch.matchedVolume,
              filledBids: lastMatch.filledBids,
              filledAsks: lastMatch.filledAsks,
            });
          }

          const history = loadSavedHistoryForDex(addr);
          const lastTrade =
            lastMatch.matchedVolume > 0
              ? {
                  block: lastMatch.lastMatchBlock,
                  price: lastMatch.clearingPrice,
                  volume: lastMatch.matchedVolume,
                  filledBids: lastMatch.filledBids,
                  filledAsks: lastMatch.filledAsks,
                }
              : history.length > 0
                ? history[history.length - 1]
                : null;

          const latestPrice =
            lastTrade?.price ||
            (best.bestBid > 0 && best.bestAsk > 0
              ? Math.round((best.bestBid + best.bestAsk) / 2)
              : best.bestBid || best.bestAsk || 0);

          const prevPx = state.prevPriceByDex.get(addr);
          if (prevPx && latestPrice && latestPrice !== prevPx) {
            state.flashByDex.set(addr, {
              dir: latestPrice > prevPx ? 'up' : 'down',
              until: Date.now() + 1450,
            });
          }
          if (latestPrice > 0) {
            state.prevPriceByDex.set(addr, latestPrice);
          }

          const refFirstPx = history.length >= 2 ? history[0].price : latestPrice;
          const pctChange =
            refFirstPx > 0 && latestPrice > 0
              ? ((latestPrice - refFirstPx) / refFirstPx) * 100
              : 0;

          let totalVol = 0;
          let totalNotional = 0;
          for (const h of history) {
            totalVol += h.volume || 0;
            totalNotional += (h.price || 0) * (h.volume || 0);
          }

          state.statsByDex.set(addr, {
            entry,
            info: classifyMarket(entry),
            depth,
            bestBid: best.bestBid,
            bestAsk: best.bestAsk,
            lastMatch,
            lastTrade,
            orderCount,
            history,
            latestPrice,
            pctChange,
            totalVol,
            totalNotional,
          });
        } catch (_) {}
      })
    );

    // 3. Hydrate / refresh IAS & IFRS Fundamental Valuations for Charter-backed Spot Equities
    await refreshIfrsValuationsForListings(curBlk, shouldRefreshRegistry);

    // 4. If user is in the Individual Market Trading View, fetch full AVL orderbook & recent tape
    if (state.viewMode === 'trading' && session.inst?.dexClob) {
      const dex = session.inst.dexClob.toLowerCase();
      const activeSnap = state.statsByDex.get(dex);
      if (activeSnap) {
        state.depth = activeSnap.depth;
        state.bestBid = activeSnap.bestBid;
        state.bestAsk = activeSnap.bestAsk;
        state.lastMatch = activeSnap.lastMatch;
        state.matchHistory = activeSnap.history;
      } else {
        const [depthHex, bestHex, summaryHex] = await Promise.all([
          session.ethCall(dex, encodeAbi('bookDepth()')),
          session.ethCall(dex, encodeAbi('bestBidAndAsk()')),
          session.ethCall(dex, encodeAbi('lastMatchSummary()')),
        ]);
        state.depth = decodeBookDepthHex(depthHex);
        const best = decodeBestBidAskHex(bestHex);
        state.bestBid = best.bestBid;
        state.bestAsk = best.bestAsk;
        state.lastMatch = decodeLastMatchSummaryHex(summaryHex);
        state.matchHistory = loadSavedHistoryForDex(dex);
      }

      if (state.priceInitForDex !== dex && (state.bestAsk > 0 || state.bestBid > 0)) {
        el.inpOrderPrice.value =
          state.side === 'bid'
            ? state.bestAsk || state.bestBid
            : state.bestBid || state.bestAsk;
        state.priceInitForDex = dex;
      }

      const balPromises = [
        session.inst.faucetIdentity && session.inst.shareLedger
          ? session.getLedgerBalance(session.inst.shareLedger, session.inst.faucetIdentity)
          : Promise.resolve(0),
      ];
      if (session.myIdentityAddr) {
        balPromises.push(
          session.getLedgerBalance(session.inst.fiatLedger, session.myIdentityAddr),
          session.getLedgerBalance(session.inst.shareLedger, session.myIdentityAddr)
        );
      }
      const balRes = await Promise.all(balPromises);
      state.faucetHasBase = (balRes[0] || 0) >= 100;
      if (session.myIdentityAddr) {
        state.myFiat = balRes[1] || 0;
        state.myShare = balRes[2] || 0;
      } else {
        state.myFiat = 0;
        state.myShare = 0;
      }

      const ordCnt = activeSnap
        ? activeSnap.orderCount
        : decodeUintWord(await session.ethCall(dex, encodeAbi('orderCount()')));
      const bidLimit = Math.min(state.depth.bidCount, 24);
      const askLimit = Math.min(state.depth.askCount, 24);
      const firstId = Math.max(1, ordCnt - 37);
      const recentIds = [];
      for (let id = ordCnt; id >= firstId; id--) recentIds.push(id);

      const [rawBids, rawAsks, recentFetched] = await Promise.all([
        Promise.all(
          Array.from({ length: bidLimit }, (_, i) =>
            session
              .ethCall(dex, encodeAbi('getOrderedBidAt(uint64)', [['uint64', i]]))
              .then(decodeDexOrderHex)
              .catch(() => null)
          )
        ),
        Promise.all(
          Array.from({ length: askLimit }, (_, i) =>
            session
              .ethCall(dex, encodeAbi('getOrderedAskAt(uint64)', [['uint64', i]]))
              .then(decodeDexOrderHex)
              .catch(() => null)
          )
        ),
        Promise.all(
          recentIds.map((id) =>
            session
              .ethCall(dex, encodeAbi('getOrder(uint64)', [['uint64', id]]))
              .then(decodeDexOrderHex)
              .catch(() => null)
          )
        ),
      ]);

      state.bids = rawBids.filter(Boolean);
      state.asks = rawAsks.filter(Boolean);
      state.recentOrders = recentFetched.filter(Boolean);
    }

    syncViewVisibility();
    renderAll();
  } catch (e) {
    console.warn('DEX poll warning:', e);
  } finally {
    state.pollInFlight = false;
  }
}

function renderMiniSparklineSvg(history, pctChange) {
  const pts = (history || []).slice(-12);
  const W = 112;
  const H = 30;
  if (pts.length < 2) {
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;">
      <line x1="4" y1="${H / 2}" x2="${W - 4}" y2="${H / 2}" stroke="rgba(148,163,184,0.35)" stroke-dasharray="3 3" stroke-width="1.5" />
    </svg>`;
  }
  const prices = pts.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = Math.max(1, maxP - minP);
  const coords = pts.map((p, idx) => {
    const x = 4 + (idx / (pts.length - 1)) * (W - 8);
    const y = H - 5 - ((p.price - minP) / span) * (H - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = pctChange > 0.05 ? '#10b981' : pctChange < -0.05 ? '#f43f5e' : '#38bdf8';
  const lastPt = coords[coords.length - 1].split(',');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;">
    <polyline fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${coords.join(' ')}" />
    <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2.8" fill="${stroke}" />
  </svg>`;
}

function renderMarketsDirectory() {
  const snaps = state.listings
    .map((it) => state.statsByDex.get(it.primaryAddr.toLowerCase()))
    .filter(Boolean);

  // Global KPIs & Live Multi-AssetLedger WASM Throughput
  const notionalByCcy = { SGD: 0, USD: 0, EUR: 0 };
  const uniqueLedgers = new Set();
  let sumResting = 0;
  let sumPending = 0;
  let sumClears = 0;
  let cumOrders = 0;
  let cumLastMatchBlocks = 0;

  for (const s of snaps) {
    const ccy = s.info.quoteShort || 'SGD';
    notionalByCcy[ccy] = (notionalByCcy[ccy] || 0) + (s.totalNotional || 0);
    if (s.entry?.meta?.shareLedger) uniqueLedgers.add(String(s.entry.meta.shareLedger).toLowerCase());
    if (s.entry?.meta?.fiatLedger) uniqueLedgers.add(String(s.entry.meta.fiatLedger).toLowerCase());
    sumResting += (s.depth.bidCount || 0) + (s.depth.askCount || 0);
    sumPending += s.depth.pendingCount || 0;
    sumClears += s.history.length || 0;
    cumOrders += s.orderCount || 0;
    if (s.lastMatch?.lastMatchBlock > 0) cumLastMatchBlocks += s.lastMatch.lastMatchBlock;
  }

  // Compute live DEX WASM throughput directly from `eth_subscribe("logs")` (`OrderPlaced`, `BlockMatched`, `OrderCancelled`)
  // across all active CLOBs, with `orderCount` delta fallback if log backfill is still warming up.
  if (state.dexTxsByBlock.size > 0) {
    const sortedBlks = Array.from(state.dexTxsByBlock.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-12);
    let totalConfirmedTxs = 0;
    for (const [, rec] of sortedBlks) {
      totalConfirmedTxs += rec.txSet.size;
    }
    const avgPerBlk = Math.round(totalConfirmedTxs / Math.max(1, sortedBlks.length));
    if (avgPerBlk > 0) {
      state.liveTxsPerBlock = avgPerBlk;
    }
    const liveBlks = sortedBlks.filter(([, rec]) => !rec.isBackfill);
    if (liveBlks.length >= 2) {
      const dtSec = (liveBlks[liveBlks.length - 1][1].ts - liveBlks[0][1].ts) / 1000;
      let liveWindowTxs = 0;
      for (let i = 1; i < liveBlks.length; i++) liveWindowTxs += liveBlks[i][1].txSet.size;
      if (dtSec >= 1.5 && liveWindowTxs > 0) {
        state.liveDexTps = liveWindowTxs / dtSec;
      }
    } else if (avgPerBlk > 0 && state.liveDexTps === 0) {
      // Immediate telemetry on page open from 30-block backfill (~4.2s Subnet 1 block cadence)
      state.liveDexTps = avgPerBlk / 4.2;
    }
  } else if (snaps.length > 0 && session.blockNumber > 0 && cumOrders > 0) {
    const nowTs = Date.now();
    const lastSample = state.tpsSamples[state.tpsSamples.length - 1];
    if (!lastSample || session.blockNumber > lastSample.blk || cumOrders > lastSample.cumOrders) {
      state.tpsSamples.push({
        ts: nowTs,
        blk: session.blockNumber,
        cumOrders,
        cumClears: sumClears,
      });
      while (state.tpsSamples.length > 16 && nowTs - state.tpsSamples[0].ts > 28000) {
        state.tpsSamples.shift();
      }
    }
    if (state.tpsSamples.length >= 2) {
      const oldest = state.tpsSamples[0];
      const newest = state.tpsSamples[state.tpsSamples.length - 1];
      const dtSec = (newest.ts - oldest.ts) / 1000;
      const dBlocks = Math.max(1, newest.blk - oldest.blk);
      const dOrders = Math.max(0, newest.cumOrders - oldest.cumOrders);
      const estDexTxs = Math.round(dOrders * 1.22);
      if (dtSec >= 2.5 && estDexTxs > 0) {
        state.liveDexTps = estDexTxs / dtSec;
        state.liveTxsPerBlock = Math.round(estDexTxs / dBlocks);
      }
    }
  }

  const ledgerCount = uniqueLedgers.size || snaps.length * 2;
  const sgdEqTotal =
    Math.round(
      (notionalByCcy.SGD || 0) +
        (notionalByCcy.USD || 0) * 1.34 +
        (notionalByCcy.EUR || 0) * 1.46
    );

  if (el.mktKpiCount) {
    el.mktKpiCount.textContent = `${snaps.length || state.listings.length} Markets`;
    el.mktKpiCountSub.textContent = `${ledgerCount} Active AssetLedgers • 24 AI Desks & Bots`;
  }
  if (el.mktKpiVol) {
    el.mktKpiVol.textContent = `~${fmtNum(sgdEqTotal)} SGD eq.`;
    const parts = [];
    if (notionalByCcy.SGD > 0) parts.push(`${fmtNum(notionalByCcy.SGD)} SGD`);
    if (notionalByCcy.USD > 0) parts.push(`${fmtNum(notionalByCcy.USD)} USD`);
    if (notionalByCcy.EUR > 0) parts.push(`${fmtNum(notionalByCcy.EUR)} EUR`);
    el.mktKpiVolSub.textContent = parts.length ? parts.join(' • ') : `Multi-currency AssetLedger DvP`;
  }
  if (el.mktKpiDepth) {
    el.mktKpiDepth.textContent = `${fmtNum(sumResting)} Resting`;
    el.mktKpiDepthSub.textContent =
      sumPending > 0
        ? `⚡ +${fmtNum(sumPending)} pending next-block intake`
        : `AVL Price-Level Trees active`;
  }
  if (el.mktKpiTrades) {
    el.mktKpiTrades.textContent = `${fmtNum(sumClears)} Block Clears`;
    el.mktKpiTradesSub.textContent = `Zero intra-block MEV front-running`;
  }
  if (el.mktKpiBlock) {
    if (state.liveDexTps > 0) {
      el.mktKpiBlock.textContent = `⚡ ${state.liveDexTps.toFixed(1)} DEX TPS`;
      el.mktKpiBlockSub.textContent = `Blk #${fmtNum(session.blockNumber)} • ~${fmtNum(state.liveTxsPerBlock)} WASM txs/blk`;
    } else {
      el.mktKpiBlock.textContent = session.blockNumber
        ? `Block #${fmtNum(session.blockNumber)}`
        : 'Connecting…';
      el.mktKpiBlockSub.textContent = `${snaps.length} CLOBs × ${ledgerCount} AssetLedgers live`;
    }
  }

  const filtered = snaps.filter((s) => {
    if (state.categoryFilter !== 'all' && s.info.cat !== state.categoryFilter) {
      return false;
    }
    if (state.searchQuery) {
      const hay = `${s.info.pair} ${s.info.displayName} ${s.info.badge} ${s.entry.primaryAddr}`.toLowerCase();
      if (!hay.includes(state.searchQuery)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    el.marketsTbody.innerHTML = `
      <tr>
        <td colspan="8" style="color:var(--txt-2);padding:20px 12px;">
          ${snaps.length ? 'No markets match your current filter/search.' : 'Loading live Subnet 1 CLOB markets…'}
        </td>
      </tr>
    `;
    return;
  }

  const now = Date.now();
  el.marketsTbody.innerHTML = filtered
    .map((s) => {
      const addr = s.entry.primaryAddr.toLowerCase();
      const fl = state.flashByDex.get(addr);
      const flashCls =
        fl && fl.until > now ? (fl.dir === 'up' ? 'dex-flash-up' : 'dex-flash-down') : '';

      const pxStr = s.latestPrice > 0 ? `${fmtNum(s.latestPrice)} ${s.info.quoteShort}` : '—';
      const lastBlkStr = s.lastTrade?.block
        ? `Cleared Blk #${fmtNum(s.lastTrade.block)}`
        : 'Awaiting match';

      let ifrsCellPill = '';
      const ifrsRec = state.ifrsByDex.get(addr);
      if (ifrsRec?.stmt && ifrsRec.totalShares > 0) {
        const v = computeTriangulatedValuation(ifrsRec.stmt, {
          totalShares: ifrsRec.totalShares,
          dexPrice: s.latestPrice,
          dexBestBid: s.bestBid,
          dexBestAsk: s.bestAsk,
          dexAddress: addr,
          shareTicker: s.info.baseSymbol,
        });
        if (v?.composite.sharePrice) {
          const vPx =
            v.composite.sharePrice >= 100
              ? v.composite.sharePrice.toFixed(1)
              : v.composite.sharePrice.toFixed(2);
          const pd = v.market.premiumDiscountPct;
          const pdTxt =
            pd !== null ? ` (${pd > 0 ? '+' : ''}${pd.toFixed(0)}%)` : '';
          const col =
            pd !== null && pd <= -10
              ? '#34d399'
              : pd !== null && pd >= 12
                ? '#fbbf24'
                : '#67e8f9';
          ifrsCellPill = `<div style="font-family:var(--mono);font-size:10px;color:${col};margin-top:2px;font-weight:700;">💎 IFRS V*: ${vPx} ${escapeHtml(s.info.quoteShort)}${pdTxt}</div>`;
        }
      }

      const pct = s.pctChange || 0;
      const pctSign = pct > 0 ? '+' : '';
      const pctCls = pct > 0.05 ? 'green' : pct < -0.05 ? 'red' : 'cyan';

      const bb = s.bestBid > 0 ? fmtNum(s.bestBid) : '—';
      const ba = s.bestAsk > 0 ? fmtNum(s.bestAsk) : '—';
      const isCrossed = s.bestBid > 0 && s.bestAsk > 0 && s.bestBid >= s.bestAsk;
      const spreadSub = isCrossed
        ? `<span style="color:#fcd34d;">⚡ Crossed — Clearing!</span>`
        : s.bestBid > 0 && s.bestAsk > s.bestBid
          ? `Spread: ${s.bestAsk - s.bestBid} ${s.info.quoteShort}`
          : 'Top-of-Book';

      const totRest = Math.max(1, s.depth.bidCount + s.depth.askCount);
      const bidPct = Math.round((s.depth.bidCount / totRest) * 100);
      const askPct = 100 - bidPct;

      return `
        <tr class="dex-listing-row ${flashCls}" data-open-dex="${escapeHtml(addr)}">
          <td>
            <div class="dex-pair-cell">
              <span class="dex-pair-icon">${s.info.icon}</span>
              <div>
                <div class="dex-pair-ticker">
                  <span>${escapeHtml(s.info.baseSymbol)}</span>
                  <span class="dex-pair-quote">/ ${escapeHtml(s.info.quoteSymbol)}</span>
                </div>
                <div class="dex-pair-name">
                  ${escapeHtml(s.info.displayName)} • <code>${shortAddr(addr)}</code>
                </div>
              </div>
            </div>
          </td>
          <td>
            <span class="inst-badge ${s.info.badgeCls}">${escapeHtml(s.info.badge)}</span>
          </td>
          <td>
            <div style="font-family:var(--mono);font-size:14.5px;font-weight:800;color:${pct < -0.05 ? '#fda4af' : '#6ee7b7'};">
              ${escapeHtml(pxStr)}
            </div>
            <div style="font-family:var(--mono);font-size:10.5px;color:var(--txt-2);margin-top:2px;">
              ${escapeHtml(lastBlkStr)}
            </div>
            ${ifrsCellPill}
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              ${renderMiniSparklineSvg(s.history, pct)}
              <span class="inst-badge ${pctCls}">${pctSign}${pct.toFixed(2)}%</span>
            </div>
          </td>
          <td style="font-family:var(--mono);">
            <div>
              <span style="color:#6ee7b7;font-weight:700;">${bb}</span>
              <span style="color:var(--txt-2);"> × </span>
              <span style="color:#fda4af;font-weight:700;">${ba}</span>
            </div>
            <div style="font-size:10.5px;color:var(--txt-2);margin-top:2px;">${spreadSub}</div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11.5px;">
              <span style="color:#6ee7b7;">${s.depth.bidCount}B</span>
              <span style="color:var(--txt-2);">/</span>
              <span style="color:#fda4af;">${s.depth.askCount}A</span>
              ${
                s.depth.pendingCount > 0
                  ? `<span class="inst-badge amber">+${s.depth.pendingCount} intake</span>`
                  : ''
              }
            </div>
            <div class="dex-liq-bar-track">
              <div class="dex-liq-bar-bid" style="width:${bidPct}%;"></div>
              <div class="dex-liq-bar-ask" style="width:${askPct}%;"></div>
            </div>
          </td>
          <td style="font-family:var(--mono);">
            <div style="font-weight:700;color:var(--txt-0);">
              ${fmtNum(s.totalVol)} ${escapeHtml(s.info.baseSymbol)}
            </div>
            <div style="font-size:10.5px;color:var(--txt-2);margin-top:2px;">
              ${fmtNum(s.totalNotional)} ${escapeHtml(s.info.quoteShort)} notional
            </div>
          </td>
          <td style="text-align:right;">
            <button type="button" class="inst-btn sm primary" data-open-dex="${escapeHtml(addr)}">
              Trade →
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function aggregateLevels(orders, pendingOrders, isBid) {
  const map = new Map();
  for (const o of orders) {
    const cur = map.get(o.price) || { price: o.price, qty: 0, count: 0, pendingQty: 0, mine: false };
    cur.qty += o.remQty;
    cur.count += 1;
    if (session.myIdentityAddr && o.trader === session.myIdentityAddr.toLowerCase()) cur.mine = true;
    map.set(o.price, cur);
  }
  for (const p of pendingOrders) {
    const cur = map.get(p.price) || { price: p.price, qty: 0, count: 0, pendingQty: 0, mine: false };
    cur.qty += p.remQty;
    cur.pendingQty += p.remQty;
    cur.count += 1;
    if (session.myIdentityAddr && p.trader === session.myIdentityAddr.toLowerCase()) cur.mine = true;
    map.set(p.price, cur);
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => (isBid ? b.price - a.price : a.price - b.price));
  return arr;
}

function renderBlockHistoryChart(meta) {
  const pts = state.matchHistory.slice(-14);
  if (!pts.length) {
    el.blockChartWrap.innerHTML = `<div style="padding:18px;color:var(--txt-2);font-size:12px;">Awaiting next block match — AI market makers &amp; crossing takers are active on Subnet 1!</div>`;
    el.blockHistoryPills.innerHTML = '';
    return;
  }

  const W = 920;
  const H = 195;
  const padL = 54;
  const padR = 54;
  const padT = 22;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const prices = pts.map((p) => p.price);
  const vols = pts.map((p) => p.volume);
  const minPx = Math.max(1, Math.min(...prices) - 3);
  const maxPx = Math.max(...prices) + 3;
  const maxVol = Math.max(10, ...vols);

  const stepX = plotW / Math.max(1, pts.length);
  const barsSvg = [];
  const lineCoords = [];
  const dotsSvg = [];
  const xLabels = [];

  pts.forEach((pt, idx) => {
    const cx = padL + stepX * idx + stepX * 0.5;
    const barW = Math.min(44, stepX * 0.52);
    const barH = (pt.volume / maxVol) * (plotH * 0.62);
    const by = padT + plotH - barH;

    const py =
      padT +
      plotH -
      ((pt.price - minPx) / Math.max(1, maxPx - minPx)) * (plotH * 0.82) -
      plotH * 0.08;
    lineCoords.push(`${cx.toFixed(1)},${py.toFixed(1)}`);

    barsSvg.push(`
      <rect x="${(cx - barW / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="rgba(56,189,248,0.28)" stroke="rgba(56,189,248,0.55)" />
      <text x="${cx.toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle" fill="#7dd3fc" font-size="9.8" font-family="JetBrains Mono">${fmtNum(pt.volume)}u</text>
    `);

    dotsSvg.push(`
      <circle cx="${cx.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="#10b981" stroke="#ecfdf5" stroke-width="1.6" />
      <text x="${cx.toFixed(1)}" y="${(py - 9).toFixed(1)}" text-anchor="middle" fill="#6ee7b7" font-size="10.5" font-weight="700" font-family="JetBrains Mono">${pt.price} ${escapeHtml(meta.quoteShort)}</text>
    `);

    xLabels.push(`
      <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="JetBrains Mono">#${pt.block}</text>
    `);
  });

  el.blockChartWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:205px;display:block;background:rgba(7,13,26,0.65);border-radius:10px;border:1px solid var(--line);">
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="rgba(148,163,184,0.2)" />
      <text x="10" y="${padT + 12}" fill="#6ee7b7" font-size="10" font-family="JetBrains Mono">Price (${escapeHtml(meta.quoteShort)})</text>
      <text x="${W - 10}" y="${padT + 12}" text-anchor="end" fill="#38bdf8" font-size="10" font-family="JetBrains Mono">Matched Qty (${escapeHtml(meta.baseSymbol)})</text>
      ${barsSvg.join('')}
      <polyline fill="none" stroke="#10b981" stroke-width="2.4" points="${lineCoords.join(' ')}" />
      ${dotsSvg.join('')}
      ${xLabels.join('')}
    </svg>
  `;

  el.blockHistoryPills.innerHTML = pts
    .slice()
    .reverse()
    .map(
      (p) => `
      <span class="inst-badge green">
        Blk #${fmtNum(p.block)}: <strong>${fmtNum(p.price)} ${escapeHtml(meta.quoteShort)}</strong> × <strong>${fmtNum(p.volume)} ${escapeHtml(meta.baseSymbol)}</strong>
      </span>
    `
    )
    .join('');
}

function isAdversarialMevIdentity(traderAddr) {
  if (!traderAddr) return false;
  const low = traderAddr.toLowerCase();
  if (session.mevBotAddrs && session.mevBotAddrs.has(low)) return true;
  const lbl = String(session.identityLabels.get(low) || '').toUpperCase();
  return lbl.includes('MEV') || lbl.includes('SNIPER') || lbl.includes('PREDATOR');
}

function renderMevForensicsPanel(activeDex, meta) {
  if (!el.mevFeaturedWrap) return;

  if (!state.mevHistoryByDex.has(activeDex)) {
    state.mevHistoryByDex.set(activeDex, new Map());
  }
  const dexExploits = state.mevHistoryByDex.get(activeDex);
  state.mevRoleByOrderId = new Map();

  // Group recent on-chain orders by arrival `blockNumber`, sorted strictly by `orderId` (exact validator execution sequence!)
  const byBlk = new Map();
  for (const o of state.recentOrders) {
    if (!o || !o.blockNumber) continue;
    const arr = byBlk.get(o.blockNumber) || [];
    arr.push(o);
    byBlk.set(o.blockNumber, arr);
  }
  for (const arr of byBlk.values()) {
    arr.sort((a, b) => a.orderId - b.orderId);
  }

  // Pure on-chain detection of Sandwich & Front-Running exploits inside each block cohort
  for (const [blkNum, cohort] of byBlk.entries()) {
    if (cohort.length < 2) continue;

    // 1. Check 3-Leg Sandwich Pattern: Trader A places Front-Run (idx i, side S), Victim(s) !== A place side S (i < j < k), Trader A places Back-Run (idx k, side !== S)
    let foundSandwich = null;
    for (let i = 0; i < cohort.length - 2; i++) {
      const front = cohort[i];
      let backIdx = -1;
      for (let k = cohort.length - 1; k > i + 1; k--) {
        if (cohort[k].trader === front.trader && cohort[k].side !== front.side) {
          backIdx = k;
          break;
        }
      }
      if (backIdx > i + 1) {
        const back = cohort[backIdx];
        const victims = cohort
          .slice(i + 1, backIdx)
          .filter((v) => v.trader !== front.trader && v.side === front.side);
        if (victims.length > 0) {
          foundSandwich = { front, victims, back };
          break;
        }
      }
    }

    const clearedMatch = state.matchHistory.find((m) => m.block > blkNum) || null;

    if (foundSandwich) {
      const { front, victims, back } = foundSandwich;
      state.mevRoleByOrderId.set(front.orderId, {
        badge: '⚠️ MEV FRONT-RUN (1st)',
        cls: 'red',
        rowCls: 'mev-row-bot',
      });
      for (const v of victims) {
        state.mevRoleByOrderId.set(v.orderId, {
          badge: '🎯 SANDWICH TARGET',
          cls: 'cyan',
          rowCls: 'mev-row-victim',
        });
      }
      state.mevRoleByOrderId.set(back.orderId, {
        badge: '⚠️ MEV BACK-RUN (Last)',
        cls: 'red',
        rowCls: 'mev-row-bot',
      });

      const victimQty = victims.reduce((s, v) => s + v.origQty, 0);
      const spreadSpan = Math.max(2, Math.abs(front.price - back.price));
      const estSlippagePerUnit = Math.max(1, Math.round(spreadSpan * 0.45));
      const counterfactualSaved = Math.min(front.origQty, victimQty) * estSlippagePerUnit;

      dexExploits.set(blkNum, {
        block: blkNum,
        kind: 'SANDWICH',
        botTrader: front.trader,
        front,
        victims,
        back,
        victimQty,
        clearingBlock: clearedMatch?.block || 0,
        clearingPrice: clearedMatch?.price || 0,
        matchedVolume: clearedMatch?.volume || 0,
        counterfactualSaved,
        actualExtracted: 0,
      });
      continue;
    }

    // 2. Check Validator Front-Running / FIFO Queue-Sniping Pattern: MEV Bot places crossing order ahead (`orderId < victim.orderId`) of same-side Victim(s)
    const botFrontIdx = cohort.findIndex((o) => isAdversarialMevIdentity(o.trader));
    if (botFrontIdx >= 0 && botFrontIdx < cohort.length - 1) {
      const front = cohort[botFrontIdx];
      const victims = cohort
        .slice(botFrontIdx + 1)
        .filter((v) => v.trader !== front.trader && v.side === front.side);
      if (victims.length > 0) {
        state.mevRoleByOrderId.set(front.orderId, {
          badge: '⚠️ MEV FRONT-RUN',
          cls: 'red',
          rowCls: 'mev-row-bot',
        });
        for (const v of victims) {
          state.mevRoleByOrderId.set(v.orderId, {
            badge: '🎯 SNIPE TARGET',
            cls: 'cyan',
            rowCls: 'mev-row-victim',
          });
        }
        const victimQty = victims.reduce((s, v) => s + v.origQty, 0);
        const tickEst = front.price >= 180 ? 2 : 1;
        const counterfactualSaved = Math.min(front.origQty, victimQty) * (tickEst * 2);

        dexExploits.set(blkNum, {
          block: blkNum,
          kind: 'FRONTRUN',
          botTrader: front.trader,
          front,
          victims,
          back: null,
          victimQty,
          clearingBlock: clearedMatch?.block || 0,
          clearingPrice: clearedMatch?.price || 0,
          matchedVolume: clearedMatch?.volume || 0,
          counterfactualSaved,
          actualExtracted: 0,
        });
      }
    }
  }

  // Update clearingPrice on any stored exploit whose subsequent block just cleared!
  for (const ex of dexExploits.values()) {
    if (!ex.clearingPrice) {
      const cm = state.matchHistory.find((m) => m.block > ex.block);
      if (cm) {
        ex.clearingBlock = cm.block;
        ex.clearingPrice = cm.price;
        ex.matchedVolume = cm.volume;
      }
    }
  }

  const allExploits = Array.from(dexExploits.values())
    .sort((a, b) => b.block - a.block)
    .slice(0, 16);

  const sandwichCnt = allExploits.filter((x) => x.kind === 'SANDWICH').length;
  const frontrunCnt = allExploits.filter((x) => x.kind === 'FRONTRUN').length;
  const totalSaved = allExploits.reduce((s, x) => s + (x.counterfactualSaved || 0), 0);

  if (el.mevKpiAttempts) {
    el.mevKpiAttempts.textContent = `${allExploits.length} Foiled`;
    el.mevKpiAttemptsSub.textContent = `${sandwichCnt} Sandwiches • ${frontrunCnt} Front-Runs`;
  }
  if (el.mevKpiSaved) {
    el.mevKpiSaved.textContent = `${fmtNum(totalSaved)} ${meta.quoteShort}`;
    el.mevKpiSavedSub.textContent = `Protected across recent blocks`;
  }
  if (el.mevKpiExtracted) {
    el.mevKpiExtracted.textContent = `0 ${meta.quoteShort}`;
  }

  if (!allExploits.length) {
    el.mevFeaturedWrap.innerHTML = `
      <div style="padding:14px;border-radius:10px;background:rgba(6,12,24,0.65);border:1px solid var(--line);font-size:12px;color:var(--txt-2);">
        Monitoring live intra-block transaction cohorts for <strong>MEV Predator Bot</strong> &amp; <strong>FlashArb Sniper</strong> sandwich/front-run sequences…
      </div>
    `;
    if (el.mevAttackHistoryPills) el.mevAttackHistoryPills.innerHTML = '';
    return;
  }

  let activeEx =
    allExploits.find((x) => x.block === state.selectedMevBlock) ||
    allExploits.find((x) => x.clearingPrice > 0) ||
    allExploits[0];

  const isSand = activeEx.kind === 'SANDWICH';
  const fSideStr = activeEx.front.side === 1 ? 'BUY' : 'SELL';
  const bSideStr = activeEx.back ? (activeEx.back.side === 1 ? 'BUY' : 'SELL') : '';
  const victimNames = activeEx.victims
    .map((v) => session.labelForIdentity(v.trader))
    .slice(0, 2)
    .join(', ');

  // Build ordered leg cards according to interactive sequence permuter `state.mevPermIdx`
  const baseLegs = [
    {
      roleKey: 'front',
      cls: 'bot-leg',
      badge: '⚠️ MEV BOT FRONT-RUN',
      badgeCls: 'red',
      who: session.labelForIdentity(activeEx.botTrader),
      orderTag: `Order #${activeEx.front.orderId}`,
      spec: `${fSideStr} ${fmtNum(activeEx.front.origQty)} ${meta.baseSymbol} @ ${fmtNum(activeEx.front.price)} ${meta.quoteShort}`,
      intent: 'Executed via 0x000a… EOA to jump ahead of victim orders in block',
    },
    {
      roleKey: 'victim',
      cls: 'victim-leg',
      badge: '🎯 VICTIM TAKER FLOW',
      badgeCls: 'cyan',
      who: victimNames + (activeEx.victims.length > 2 ? ` +${activeEx.victims.length - 2}` : ''),
      orderTag: activeEx.victims.map((v) => `#${v.orderId}`).join(', '),
      spec: `${fSideStr} ${fmtNum(activeEx.victimQty)} ${meta.baseSymbol} @ ${fmtNum(activeEx.victims[0].price)} ${meta.quoteShort}`,
      intent: `${activeEx.victims.length} legitimate crossing order(s) targeted in Block #${fmtNum(activeEx.block)}`,
    },
  ];
  if (isSand && activeEx.back) {
    baseLegs.push({
      roleKey: 'back',
      cls: 'bot-leg',
      badge: '⚠️ MEV BOT BACK-RUN',
      badgeCls: 'red',
      who: session.labelForIdentity(activeEx.botTrader),
      orderTag: `Order #${activeEx.back.orderId}`,
      spec: `${bSideStr} ${fmtNum(activeEx.back.origQty)} ${meta.baseSymbol} @ ${fmtNum(activeEx.back.price)} ${meta.quoteShort}`,
      intent: 'Executed LAST via 0xfffe… EOA to dump back into victim price impact',
    });
  }

  let permLegs = baseLegs.slice();
  if (state.mevPermIdx === 1 && permLegs.length >= 2) {
    // Victim First: [Victim, Front, Back]
    permLegs = [baseLegs[1], baseLegs[0], ...baseLegs.slice(2)];
  } else if (state.mevPermIdx === 2) {
    // Reversed: [Back, Victim, Front] or [Victim, Front]
    permLegs = baseLegs.slice().reverse();
  }

  const pStar = activeEx.clearingPrice;
  const clearedStatusHtml = pStar
    ? `<span class="inst-badge green">🛡️ FOILED IN BLOCK #${fmtNum(activeEx.clearingBlock)} • UNIFORM P* = ${fmtNum(pStar)} ${escapeHtml(meta.quoteShort)}</span>`
    : `<span class="inst-badge amber">⏳ IN PENDING INTAKE (BLK #${fmtNum(activeEx.block)}) — CLEARING AT UNIFORM P* IN BLK #${fmtNum(activeEx.block + 1)}</span>`;

  el.mevFeaturedWrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <div style="font-size:12.5px;font-weight:700;color:var(--txt-0);">
        🔍 Block #${fmtNum(activeEx.block)} ${isSand ? '3-Leg Validator Sandwich Attempt' : 'Validator Front-Run Snipe Attempt'}
      </div>
      ${clearedStatusHtml}
    </div>

    <div class="mev-seq-grid">
      ${permLegs
        .map(
          (lg, idx) => `
          <div class="mev-leg-card ${lg.cls}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <span class="inst-badge ${lg.badgeCls}">Tx Seq #${idx + 1} • ${lg.badge}</span>
              <code style="font-size:11px;color:var(--txt-2);">${escapeHtml(lg.orderTag)}</code>
            </div>
            <div style="font-weight:800;color:var(--txt-0);font-family:var(--mono);font-size:13px;margin-top:2px;">
              ${escapeHtml(lg.spec)}
            </div>
            <div style="font-size:11.5px;color:var(--txt-1);">${escapeHtml(lg.who)}</div>
            <div style="font-size:10.5px;color:var(--txt-2);">${escapeHtml(lg.intent)}</div>
          </div>
        `
        )
        .join('')}
    </div>

    <div class="mev-compare-split">
      <div class="mev-compare-box vuln">
        <div style="font-weight:800;color:#fda4af;">❌ On a Traditional Sequential CLOB / AMM</div>
        <div style="color:var(--txt-1);line-height:1.45;">
          ${
            isSand
              ? `Executing <code>#${activeEx.front.orderId}</code> first sweeps top-of-book liquidity, forcing Victim (<code>${activeEx.victims.map((v) => '#' + v.orderId).join(',')}</code>) into worse levels before <code>#${activeEx.back.orderId}</code> unwinds at the inflated price.`
              : `Executing <code>#${activeEx.front.orderId}</code> ahead of Victim (<code>${activeEx.victims.map((v) => '#' + v.orderId).join(',')}</code>) captures 100% of cheap top-of-book liquidity and pushes Victim into worse rungs.`
          }
        </div>
        <div style="font-family:var(--mono);font-weight:800;color:#fda4af;margin-top:2px;">
          Estimated MEV Stolen from Victim: ~${fmtNum(activeEx.counterfactualSaved)} ${escapeHtml(meta.quoteShort)}
        </div>
      </div>

      <div class="mev-compare-box proof">
        <div style="font-weight:800;color:#6ee7b7;">✅ Actual Settlement on SuperLexicon <code>dex_clob.wasm</code></div>
        <div style="color:var(--txt-1);line-height:1.45;">
          ${
            pStar
              ? isSand
                ? `All crossing Block #${fmtNum(activeEx.block)} orders cleared together in Block #${fmtNum(activeEx.clearingBlock)} at <strong>Single Uniform P* = ${fmtNum(pStar)} ${escapeHtml(meta.quoteShort)}</strong>: Bot bought @ <strong>${fmtNum(pStar)}</strong>, Victim filled @ <strong>${fmtNum(pStar)}</strong>, Bot sold @ <strong>${fmtNum(pStar)}</strong>.`
                : `Both Bot and Victim shared identical <code>(price, Blk #${fmtNum(activeEx.block)})</code> cohort priority and filled at <strong>Uniform P* = ${fmtNum(pStar)} ${escapeHtml(meta.quoteShort)}</strong> via permutation-invariant pro-rata.`
              : `All Block #${fmtNum(activeEx.block)} orders are held behind the strict prior-block cutoff and will clear together at one single uniform <code>P*</code> in Block #${fmtNum(activeEx.block + 1)}.`
          }
        </div>
        <div style="font-family:var(--mono);font-weight:800;color:#6ee7b7;margin-top:2px;">
          Actual MEV Extracted: ${pStar && isSand ? `(${pStar} − ${pStar}) × Qty = ` : ''}0 ${escapeHtml(meta.quoteShort)} (100% Exploit-Proof)
        </div>
      </div>
    </div>

    <div class="mev-perm-bar">
      <div style="font-size:11.5px;color:var(--txt-1);">
        🔄 <strong>Test Intra-Block Tx Order Invariance</strong> (live on populated book — <code>P*</code>${pStar ? ` = ${fmtNum(pStar)} ${escapeHtml(meta.quoteShort)}` : ''} &amp; <code>0 ${escapeHtml(meta.quoteShort)}</code> MEV hold under EVERY sequence!):
      </div>
      <div class="mev-perm-btns">
        <button type="button" class="mev-perm-btn ${state.mevPermIdx === 0 ? 'active' : ''}" data-mev-perm="0">
          Seq 1: Bot → Victim${isSand ? ' → BackRun' : ''} (Validator Attack)
        </button>
        <button type="button" class="mev-perm-btn ${state.mevPermIdx === 1 ? 'active' : ''}" data-mev-perm="1">
          Seq 2: Victim → Bot${isSand ? ' → BackRun' : ''} (Victim First)
        </button>
        <button type="button" class="mev-perm-btn ${state.mevPermIdx === 2 ? 'active' : ''}" data-mev-perm="2">
          Seq 3: ${isSand ? 'BackRun → Victim → Bot' : 'Reversed'}
        </button>
      </div>
    </div>
  `;

  if (el.mevAttackHistoryPills) {
    el.mevAttackHistoryPills.innerHTML = allExploits
      .slice(0, 8)
      .map((ex) => {
        const isSel = ex.block === activeEx.block;
        const tag = ex.kind === 'SANDWICH' ? '🥪 Sandwich' : '⚡ Front-Run';
        const pxTxt = ex.clearingPrice ? `P*=${ex.clearingPrice} → 0 MEV` : 'Pending';
        return `
          <button
            type="button"
            class="mev-perm-btn ${isSel ? 'active' : ''}"
            data-pick-mev-blk="${ex.block}"
          >
            Blk #${fmtNum(ex.block)} ${tag} (${pxTxt})
          </button>
        `;
      })
      .join('');
  }
}

function renderTradingTerminal() {
  const meta = getActiveMarketMeta();
  const activeDex = (session.inst?.dexClob || '').toLowerCase();
  const now = Date.now();

  // Topbar & Quick Switcher
  if (el.activeMarketIcon) el.activeMarketIcon.textContent = meta.icon;
  if (el.activeMarketPairTitle) el.activeMarketPairTitle.textContent = meta.pair;
  if (el.activeMarketCategoryBadge) {
    el.activeMarketCategoryBadge.className = `inst-badge ${meta.badgeCls}`;
    el.activeMarketCategoryBadge.textContent = meta.badge;
  }
  if (el.activeMarketNameSub) {
    el.activeMarketNameSub.textContent = `${meta.displayName} • HFS ${shortAddr(activeDex)}`;
  }

  if (el.quickMarketsStrip) {
    el.quickMarketsStrip.innerHTML = state.listings
      .map((it) => {
        const addr = it.primaryAddr.toLowerCase();
        const snap = state.statsByDex.get(addr);
        const inf = snap?.info || classifyMarket(it);
        const px = snap?.latestPrice ? `${fmtNum(snap.latestPrice)}` : '—';
        const isAct = addr === activeDex;
        return `
          <button type="button" class="dex-quick-pill ${isAct ? 'active' : ''}" data-open-dex="${escapeHtml(addr)}">
            <span>${inf.icon} ${escapeHtml(inf.baseSymbol)}</span>
            <span style="color:${isAct ? '#6ee7b7' : 'var(--txt-2)'};">${px}</span>
          </button>
        `;
      })
      .join('');
  }

  // Dynamic Labels across KPIs, Tables, Faucet & Form
  if (el.kpiPairVal) el.kpiPairVal.textContent = meta.pair;
  if (activeDex) {
    el.kpiDexAddr.textContent = `HFS ${shortAddr(activeDex)} • ${meta.badge}`;
  }

  const fl = state.flashByDex.get(activeDex);
  if (el.kpiLastPriceCard) {
    el.kpiLastPriceCard.className = `inst-kpi ${
      fl && fl.until > now ? (fl.dir === 'up' ? 'dex-flash-up' : 'dex-flash-down') : ''
    }`;
  }

  const latestTrade =
    state.lastMatch.matchedVolume > 0
      ? {
          block: state.lastMatch.lastMatchBlock,
          price: state.lastMatch.clearingPrice,
          volume: state.lastMatch.matchedVolume,
          filledBids: state.lastMatch.filledBids,
          filledAsks: state.lastMatch.filledAsks,
        }
      : state.matchHistory.length > 0
        ? state.matchHistory[state.matchHistory.length - 1]
        : null;

  if (latestTrade) {
    el.kpiLastPrice.textContent = `${fmtNum(latestTrade.price)} ${meta.quoteShort}`;
    el.kpiLastBlock.textContent = `Cleared in Block #${fmtNum(latestTrade.block)}`;
    el.kpiLastVol.textContent = `${fmtNum(latestTrade.volume)} ${meta.baseSymbol}`;
    el.kpiLastFills.textContent = `${latestTrade.filledBids} Bid / ${latestTrade.filledAsks} Ask fills`;
  } else {
    el.kpiLastPrice.textContent = '—';
    el.kpiLastBlock.textContent = 'Awaiting next clearing block';
    el.kpiLastVol.textContent = `0 ${meta.baseSymbol}`;
    el.kpiLastFills.textContent = '0 Bid / 0 Ask fills';
  }

  const bb = state.bestBid ? `${fmtNum(state.bestBid)}` : '—';
  const ba = state.bestAsk ? `${fmtNum(state.bestAsk)}` : '—';
  el.kpiSpread.textContent = `${bb} × ${ba} ${meta.quoteShort}`;
  el.kpiSpreadSub.textContent =
    state.bestBid && state.bestAsk
      ? state.bestBid >= state.bestAsk
        ? `⚡ Crossed (${state.bestBid} ≥ ${state.bestAsk}) — Clearing next block!`
        : `Spread: ${state.bestAsk - state.bestBid} ${meta.quoteShort}`
      : 'AVL Tree O(1) Top-of-Book';

  el.kpiMyFiat.textContent = `${fmtNum(state.myFiat)} ${meta.quoteShort}`;
  el.kpiMyShare.textContent = session.myIdentityAddr
    ? `${fmtNum(state.myShare)} ${meta.baseSymbol} • ${session.myIdentityHandle || shortAddr(session.myIdentityAddr)}`
    : `0 ${meta.baseSymbol} • Click Faucet or Place Order to bind Identity`;

  el.pendingIntakeBadge.textContent = `Pending Intake: ${state.depth.pendingCount} order(s)`;
  if (el.simMatcherBadge) {
    el.simMatcherBadge.textContent = state.lastMatch?.lastMatchBlock
      ? `🤖 Simulator Auto-Matcher • Sweep #${fmtNum(state.lastMatch.lastMatchBlock)}`
      : '🤖 Simulator Auto-Matcher • 1x/Block Guard';
  }

  renderDexIfrsValuationStrip(activeDex, meta, latestTrade);
  renderBlockHistoryChart(meta);
  renderMevForensicsPanel(activeDex, meta);

  // Orderbook Table Headers & Faucet Labels
  if (el.bidsCardTitle) el.bidsCardTitle.textContent = `🟢 Bids (Buy ${meta.baseSymbol})`;
  if (el.asksCardTitle) el.asksCardTitle.textContent = `🔴 Asks (Sell ${meta.baseSymbol})`;
  if (el.bidsPriceTh) el.bidsPriceTh.textContent = `Price (${meta.quoteShort})`;
  if (el.bidsQtyTh) el.bidsQtyTh.textContent = `Qty (${meta.baseSymbol})`;
  if (el.bidsTotalTh) el.bidsTotalTh.textContent = `Total (${meta.quoteShort})`;
  if (el.asksPriceTh) el.asksPriceTh.textContent = `Price (${meta.quoteShort})`;
  if (el.asksQtyTh) el.asksQtyTh.textContent = `Qty (${meta.baseSymbol})`;
  if (el.asksTotalTh) el.asksTotalTh.textContent = `Total (${meta.quoteShort})`;

  if (el.faucetSymbolsBadge) {
    el.faucetSymbolsBadge.textContent = `${meta.quoteSymbol} & ${meta.baseSymbol}`;
  }
  if (el.btnFaucetFiat) {
    el.btnFaucetFiat.textContent = `+25,000 ${meta.quoteShort}`;
  }
  if (el.btnFaucetShare) {
    el.btnFaucetShare.textContent = state.faucetHasBase
      ? `+500 ${meta.baseSymbol}`
      : `${meta.baseSymbol} (Charter Minted)`;
    el.btnFaucetShare.disabled = state.busy || !state.faucetHasBase;
  }
  if (el.faucetFuturesNote) {
    el.faucetFuturesNote.style.display = state.faucetHasBase ? 'none' : 'block';
  }
  if (el.lblOrderPrice) {
    el.lblOrderPrice.textContent = `Limit Price (${meta.quoteShort} per ${meta.baseSymbol})`;
  }
  if (el.lblOrderQty) {
    el.lblOrderQty.textContent = `Quantity (${meta.baseSymbol} Units)`;
  }

  const pendingBids = state.recentOrders.filter((o) => o.status === 0 && o.side === 1);
  const pendingAsks = state.recentOrders.filter((o) => o.status === 0 && o.side === 2);

  const bidLvls = aggregateLevels(state.bids, pendingBids, true);
  const askLvls = aggregateLevels(state.asks, pendingAsks, false);
  const maxBidQty = Math.max(1, ...bidLvls.map((l) => l.qty));
  const maxAskQty = Math.max(1, ...askLvls.map((l) => l.qty));

  // Track level flashes on quantity changes
  for (const l of bidLvls) {
    const k = `${activeDex}:bid:${l.price}`;
    const prev = state.prevBookLevels.get(k);
    if (prev !== undefined && prev !== l.qty) {
      state.bookFlashUntil.set(k, { dir: 'up', until: now + 1200 });
    } else if (prev === undefined && state.prevBookLevels.size > 0) {
      state.bookFlashUntil.set(k, { dir: 'up', until: now + 1200 });
    }
    state.prevBookLevels.set(k, l.qty);
  }
  for (const l of askLvls) {
    const k = `${activeDex}:ask:${l.price}`;
    const prev = state.prevBookLevels.get(k);
    if (prev !== undefined && prev !== l.qty) {
      state.bookFlashUntil.set(k, { dir: 'down', until: now + 1200 });
    } else if (prev === undefined && state.prevBookLevels.size > 0) {
      state.bookFlashUntil.set(k, { dir: 'down', until: now + 1200 });
    }
    state.prevBookLevels.set(k, l.qty);
  }

  el.bidBookMeta.textContent = `${state.depth.bidCount} resting${pendingBids.length ? ` + ${pendingBids.length} pending` : ''}`;
  el.askBookMeta.textContent = `${state.depth.askCount} resting${pendingAsks.length ? ` + ${pendingAsks.length} pending` : ''}`;

  el.bidsTbody.innerHTML = bidLvls.length
    ? bidLvls
        .map((l) => {
          const pct = Math.min(100, Math.round((l.qty / maxBidQty) * 100));
          const bf = state.bookFlashUntil.get(`${activeDex}:bid:${l.price}`);
          const fCls = bf && bf.until > now ? 'dex-flash-up' : '';
          return `
            <tr class="dex-depth-row ${fCls}" data-pick-price="${l.price}" style="cursor:pointer;background:linear-gradient(90deg, transparent ${100 - pct}%, rgba(16,185,129,0.16) ${100 - pct}%);">
              <td style="color:#6ee7b7;font-weight:800;">${fmtNum(l.price)} ${escapeHtml(meta.quoteShort)} ${l.mine ? '★' : ''}</td>
              <td>${fmtNum(l.qty)}</td>
              <td>${fmtNum(l.price * l.qty)}</td>
              <td>${l.count} FIFO${l.pendingQty ? ` <span class="inst-badge amber">+${fmtNum(l.pendingQty)} pend</span>` : ''}</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="4" style="color:var(--txt-2);">No active Bids</td></tr>`;

  el.asksTbody.innerHTML = askLvls.length
    ? askLvls
        .map((l) => {
          const pct = Math.min(100, Math.round((l.qty / maxAskQty) * 100));
          const af = state.bookFlashUntil.get(`${activeDex}:ask:${l.price}`);
          const fCls = af && af.until > now ? 'dex-flash-down' : '';
          return `
            <tr class="dex-depth-row ${fCls}" data-pick-price="${l.price}" style="cursor:pointer;background:linear-gradient(90deg, transparent ${100 - pct}%, rgba(244,63,94,0.16) ${100 - pct}%);">
              <td style="color:#fda4af;font-weight:800;">${fmtNum(l.price)} ${escapeHtml(meta.quoteShort)} ${l.mine ? '★' : ''}</td>
              <td>${fmtNum(l.qty)}</td>
              <td>${fmtNum(l.price * l.qty)}</td>
              <td>${l.count} FIFO${l.pendingQty ? ` <span class="inst-badge amber">+${fmtNum(l.pendingQty)} pend</span>` : ''}</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="4" style="color:var(--txt-2);">No active Asks</td></tr>`;

  const statusBadge = (st) => {
    if (st === 0) return `<span class="inst-badge amber">PENDING (Next Blk)</span>`;
    if (st === 1) return `<span class="inst-badge cyan">RESTING BOOK</span>`;
    if (st === 2) return `<span class="inst-badge green">FILLED</span>`;
    return `<span class="inst-badge red">CANCELLED</span>`;
  };

  el.recentOrdersTbody.innerHTML = state.recentOrders.length
    ? state.recentOrders
        .slice(0, 22)
        .map((o) => {
          const isMine =
            session.myIdentityAddr && o.trader === session.myIdentityAddr.toLowerCase();
          const canCancel = isMine && (o.status === 0 || o.status === 1);
          const mevRole = state.mevRoleByOrderId.get(o.orderId);
          const rowCls = mevRole?.rowCls || '';
          const roleHtml = mevRole
            ? ` <span class="inst-badge ${mevRole.cls}">${escapeHtml(mevRole.badge)}</span>`
            : '';
          return `
            <tr class="${rowCls}">
              <td>#${o.orderId}</td>
              <td>#${fmtNum(o.blockNumber)}</td>
              <td>${escapeHtml(session.labelForIdentity(o.trader))}${roleHtml}</td>
              <td style="color:${o.side === 1 ? '#6ee7b7' : '#fda4af'};font-weight:700;">${o.side === 1 ? 'BID' : 'ASK'}</td>
              <td>${fmtNum(o.price)} ${escapeHtml(meta.quoteShort)}</td>
              <td>${fmtNum(o.remQty)} / ${fmtNum(o.origQty)} ${escapeHtml(meta.baseSymbol)}</td>
              <td>${statusBadge(o.status)}</td>
              <td>${canCancel ? `<button class="inst-btn sm rose" data-cancel-order="${o.orderId}">Cancel</button>` : '—'}</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="8" style="color:var(--txt-2);">Loading on-chain orders…</td></tr>`;

  updateOrderFormPreview();
}

function fmtCompactSgd(n) {
  const abs = Math.abs(n || 0);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${fmtNum(Math.round(abs))}`;
}

function renderDexIfrsValuationStrip(activeDex, meta, latestTrade) {
  if (!el.dexIfrsValuationBar || !el.dexIfrsValuationBody) return;
  const rec = state.ifrsByDex.get(activeDex);
  if (!rec?.stmt || !(rec.totalShares > 0)) {
    el.dexIfrsValuationBar.style.display = 'none';
    return;
  }

  const curPx =
    latestTrade?.price ||
    (state.bestBid > 0 && state.bestAsk > 0
      ? Math.round((state.bestBid + state.bestAsk) / 2)
      : state.bestBid || state.bestAsk || 0);

  const val = computeTriangulatedValuation(rec.stmt, {
    totalShares: rec.totalShares,
    dexPrice: curPx,
    dexBestBid: state.bestBid,
    dexBestAsk: state.bestAsk,
    dexAddress: activeDex,
    shareTicker: meta.baseSymbol,
  });
  if (!val || val.composite.sharePrice === null) {
    el.dexIfrsValuationBar.style.display = 'none';
    return;
  }

  el.dexIfrsValuationBar.style.display = 'block';
  const c = val.composite;
  const m = val.market;
  const r = val.ratios;
  const f = val.fundamentals;

  const fmtPx = (x) => (x === null || x === undefined ? '—' : x >= 100 ? x.toFixed(1) : x.toFixed(2));
  const vRound = Math.max(1, Math.round(c.sharePrice));

  const lensById = Object.fromEntries(val.lenses.map((l) => [l.id, l]));
  const pd = m.premiumDiscountPct;
  const pdSign = pd !== null && pd > 0 ? '+' : '';
  const sigColor =
    m.signalClass === 'emerald'
      ? '#34d399'
      : m.signalClass === 'amber'
        ? '#fbbf24'
        : '#67e8f9';

  const peTxt = r.impliedPE !== null ? `${r.impliedPE.toFixed(1)}×` : '—';
  const evArrTxt = r.impliedEvArr !== null ? `${r.impliedEvArr.toFixed(1)}×` : '—';
  const evEbTxt = r.impliedEvEbitda !== null ? `${r.impliedEvEbitda.toFixed(1)}×` : '—';

  el.dexIfrsValuationBody.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:14px;font-weight:800;color:#f8fafc;">💎 Live IAS / IFRS Fundamental Valuation vs Clearing Price (<code>P*</code>)</span>
          <span class="inst-badge cyan">✓ IAS 24 Wash-Sale Filtered</span>
          <span class="inst-badge green">✓ Virgin Custody (${fmtNum(f.bookedCash)} ${escapeHtml(meta.quoteShort)} Cash)</span>
        </div>
        <div style="font-size:11px;color:var(--txt-2);font-family:var(--mono);margin-top:2px;">
          Computed continuously from <code>AccountingLedger</code> (<code>${shortAddr(rec.accountingLedger)}</code>) × <code>${fmtNum(rec.totalShares)} ${escapeHtml(meta.baseSymbol)}</code> Charter shares
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <button type="button" class="inst-btn sm" data-pick-price="${vRound}" title="Populate Limit Order Price at IFRS Intrinsic Fair Value">
          🎯 Quote @ V* (${fmtNum(vRound)} ${escapeHtml(meta.quoteShort)})
        </button>
        <a class="inst-btn sm primary" href="/accounting.html?hfs=${encodeURIComponent(rec.accountingLedger)}" style="text-decoration:none;">
          📘 Open Live IFRS Books &amp; DCF Studio →
        </a>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:10px;">
      <div style="padding:9px 12px;border-radius:9px;background:rgba(6,13,26,0.82);border:1px solid rgba(34,211,238,0.35);">
        <div class="inst-kpi-label">IFRS Intrinsic Fair Value (V*)</div>
        <div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#22d3ee;margin-top:2px;">
          ${fmtPx(c.sharePrice)} ${escapeHtml(meta.quoteShort)} / sh
        </div>
        <div class="inst-kpi-sub">Intrinsic Equity: ${fmtCompactSgd(c.equityValue)} ${escapeHtml(meta.quoteShort)}</div>
      </div>

      <div style="padding:9px 12px;border-radius:9px;background:rgba(6,13,26,0.82);border:1px solid rgba(51,65,85,0.65);">
        <div class="inst-kpi-label">4-Lens Fundamental Range</div>
        <div style="font-family:var(--mono);font-size:12px;font-weight:700;color:#e2e8f0;margin-top:4px;">
          <span style="color:#a78bfa;">EBO ${fmtPx(lensById.ebo?.sharePrice)}</span> •
          <span style="color:#38bdf8;">DCF ${fmtPx(lensById.dcf?.sharePrice)}</span> •
          <span style="color:#fbbf24;">Mult ${fmtPx(lensById.multiples?.sharePrice)}</span>
        </div>
        <div class="inst-kpi-sub">Tangible Book Floor (NAV): ${fmtPx(lensById.nav?.sharePrice)} ${escapeHtml(meta.quoteShort)}/sh</div>
      </div>

      <div style="padding:9px 12px;border-radius:9px;background:rgba(6,13,26,0.82);border:1px solid rgba(51,65,85,0.65);">
        <div class="inst-kpi-label">Market P* vs Intrinsic V*</div>
        <div style="font-family:var(--mono);font-size:15.5px;font-weight:800;color:${sigColor};margin-top:3px;">
          ${pd !== null ? `${pdSign}${pd.toFixed(1)}% • ${escapeHtml(m.valuationSignal)}` : 'AWAITING P*'}
        </div>
        <div class="inst-kpi-sub">On-Chain Mkt Cap: ${m.marketCap ? `${fmtCompactSgd(m.marketCap)} ${escapeHtml(meta.quoteShort)}` : '—'}</div>
      </div>

      <div style="padding:9px 12px;border-radius:9px;background:rgba(6,13,26,0.82);border:1px solid rgba(51,65,85,0.65);">
        <div class="inst-kpi-label">Implied Multiples @ Live P*</div>
        <div style="font-family:var(--mono);font-size:12.5px;font-weight:700;color:#f8fafc;margin-top:4px;">
          P/E ${peTxt} • EV/ARR ${evArrTxt} • EV/EBITDA ${evEbTxt}
        </div>
        <div class="inst-kpi-sub">Clean ARR: ${fmtCompactSgd(f.annualizedArmsRev)}/yr (${f.grossMarginPct.toFixed(0)}% GM)</div>
      </div>
    </div>
  `;
}

function renderAll() {
  if (state.viewMode === 'listings') {
    renderMarketsDirectory();
  } else {
    renderTradingTerminal();
  }
}

function updateOrderFormPreview() {
  const meta = getActiveMarketMeta();
  const px = Math.max(0, Number(el.inpOrderPrice.value) || 0);
  const qty = Math.max(0, Number(el.inpOrderQty.value) || 0);
  el.tabSideBid.textContent = `BUY ${meta.baseSymbol} (Bid)`;
  el.tabSideAsk.textContent = `SELL ${meta.baseSymbol} (Ask)`;

  if (state.side === 'bid') {
    el.tabSideBid.className = 'dex-side-tab active-bid';
    el.tabSideAsk.className = 'dex-side-tab';
    el.orderEscrowLabel.textContent = `${meta.quoteSymbol} Escrow:`;
    el.orderEscrowVal.textContent = `${fmtNum(px * qty)} ${meta.quoteShort}`;
    el.btnSubmitOrder.className = 'inst-btn buy';
    el.btnSubmitOrder.textContent = `🟢 Submit Signed BUY (${fmtNum(qty)} ${meta.baseSymbol} @ ${fmtNum(px)} ${meta.quoteShort})`;
  } else {
    el.tabSideBid.className = 'dex-side-tab';
    el.tabSideAsk.className = 'dex-side-tab active-ask';
    el.orderEscrowLabel.textContent = `${meta.baseSymbol} Escrow:`;
    el.orderEscrowVal.textContent = `${fmtNum(qty)} ${meta.baseSymbol}`;
    el.btnSubmitOrder.className = 'inst-btn sell';
    el.btnSubmitOrder.textContent = `🔴 Submit Signed SELL (${fmtNum(qty)} ${meta.baseSymbol} @ ${fmtNum(px)} ${meta.quoteShort})`;
  }
}

el.tabSideBid.addEventListener('click', () => {
  state.side = 'bid';
  if (state.bestAsk > 0) el.inpOrderPrice.value = state.bestAsk;
  updateOrderFormPreview();
});
el.tabSideAsk.addEventListener('click', () => {
  state.side = 'ask';
  if (state.bestBid > 0) el.inpOrderPrice.value = state.bestBid;
  updateOrderFormPreview();
});
el.inpOrderPrice.addEventListener('input', updateOrderFormPreview);
el.inpOrderQty.addEventListener('input', updateOrderFormPreview);

el.btnCrossBest.addEventListener('click', () => {
  if (state.side === 'bid' && state.bestAsk > 0) el.inpOrderPrice.value = state.bestAsk;
  else if (state.side === 'ask' && state.bestBid > 0) el.inpOrderPrice.value = state.bestBid;
  updateOrderFormPreview();
});
el.btnJoinBest.addEventListener('click', () => {
  if (state.side === 'bid' && state.bestBid > 0) el.inpOrderPrice.value = state.bestBid;
  else if (state.side === 'ask' && state.bestAsk > 0) el.inpOrderPrice.value = state.bestAsk;
  updateOrderFormPreview();
});

document.addEventListener('click', async (e) => {
  const permBtn = e.target.closest('[data-mev-perm]');
  if (permBtn) {
    state.mevPermIdx = Number(permBtn.getAttribute('data-mev-perm') || 0);
    renderTradingTerminal();
    return;
  }

  const mevBlkBtn = e.target.closest('[data-pick-mev-blk]');
  if (mevBlkBtn) {
    state.selectedMevBlock = Number(mevBlkBtn.getAttribute('data-pick-mev-blk') || 0);
    renderTradingTerminal();
    return;
  }

  const openTrigger = e.target.closest('[data-open-dex]');
  if (openTrigger) {
    const addr = String(openTrigger.getAttribute('data-open-dex') || '').toLowerCase();
    const entry = state.listings.find((it) => it.primaryAddr.toLowerCase() === addr);
    if (entry) {
      await openMarketTradingView(entry, { pushHistory: true });
    }
    return;
  }

  const row = e.target.closest('[data-pick-price]');
  if (row) {
    el.inpOrderPrice.value = row.getAttribute('data-pick-price');
    updateOrderFormPreview();
    return;
  }

  const cancelBtn = e.target.closest('[data-cancel-order]');
  if (cancelBtn && !state.busy) {
    const oid = Number(cancelBtn.getAttribute('data-cancel-order'));
    state.busy = true;
    try {
      showBanner(`⏳ Cancelling Order #${oid} and refunding escrowed balance…`, 'info');
      await session.sendAsMyIdentity(
        encodeAbi('dexCancelOrder(address,uint64)', [
          ['address', session.inst.dexClob],
          ['uint64', oid],
        ]),
        `dexCancelOrder(#${oid})`,
        'DexClob'
      );
      await refreshDexState();
      showBanner(`✅ Order #${oid} cancelled in O(1) — escrowed AssetLedger funds refunded!`, 'ok');
    } catch (err) {
      showBanner(`🚫 Cancel failed: ${escapeHtml(err.message)}`, 'err');
    } finally {
      state.busy = false;
    }
  }
});

el.btnFaucetFiat.addEventListener('click', async () => {
  if (state.busy) return;
  const meta = getActiveMarketMeta();
  state.busy = true;
  el.btnFaucetFiat.disabled = true;
  try {
    await session.requestFiatTopUp(
      25000,
      (msg) => showBanner(`⏳ ${escapeHtml(msg)}`, 'info'),
      meta.quoteSymbol
    );
    await refreshDexState();
    showBanner(
      `✅ Credited <strong>+25,000 ${escapeHtml(meta.quoteSymbol)}</strong> into your verified <code>Identity</code> HFS on <code>AssetLedger</code>!`,
      'ok'
    );
  } catch (err) {
    showBanner(`🚫 Faucet error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
    el.btnFaucetFiat.disabled = false;
  }
});

el.btnFaucetShare.addEventListener('click', async () => {
  if (state.busy || !state.faucetHasBase) return;
  const meta = getActiveMarketMeta();
  state.busy = true;
  el.btnFaucetShare.disabled = true;
  try {
    await session.requestShareGrant(
      500,
      (msg) => showBanner(`⏳ ${escapeHtml(msg)}`, 'info'),
      meta.baseSymbol
    );
    await refreshDexState();
    showBanner(
      `✅ Credited <strong>+500 ${escapeHtml(meta.baseSymbol)}</strong> units into your verified <code>Identity</code> HFS!`,
      'ok'
    );
  } catch (err) {
    showBanner(`🚫 Faucet error: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
    el.btnFaucetShare.disabled = !state.faucetHasBase;
  }
});

el.dexOrderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy || !session.inst?.dexClob) return;
  const meta = getActiveMarketMeta();
  const px = Math.floor(Number(el.inpOrderPrice.value));
  const qty = Math.floor(Number(el.inpOrderQty.value));
  if (px <= 0 || qty <= 0) return;

  state.busy = true;
  el.btnSubmitOrder.disabled = true;
  try {
    const myId = await session.ensureMyIdentity((msg) => showBanner(`⏳ ${escapeHtml(msg)}`, 'info'));
    const [curFiat, curShare] = await Promise.all([
      session.getLedgerBalance(session.inst.fiatLedger, myId),
      session.getLedgerBalance(session.inst.shareLedger, myId),
    ]);

    if (state.side === 'bid') {
      const needed = px * qty;
      if (curFiat < needed && el.chkAutoTopUp.checked) {
        const topUpAmt = Math.max(25000, needed - curFiat + 5000);
        await session.requestFiatTopUp(
          topUpAmt,
          (msg) => showBanner(`💧 Auto-Top-Up: ${escapeHtml(msg)}`, 'info'),
          meta.quoteSymbol
        );
      }
      showBanner(
        `⏳ Signing <code>dexPlaceBid(${px} ${escapeHtml(meta.quoteShort)}, ${qty} ${escapeHtml(meta.baseSymbol)})</code> &amp; escrowing ${fmtNum(needed)} ${escapeHtml(meta.quoteShort)}…`,
        'info'
      );
      const rcpt = await session.sendAsMyIdentity(
        encodeAbi('dexPlaceBid(address,uint64,uint64)', [
          ['address', session.inst.dexClob],
          ['uint64', px],
          ['uint64', qty],
        ]),
        `dexPlaceBid(${qty}@${px})`,
        `DexClob(${meta.baseSymbol})`
      );
      const ordBlk = Number(BigInt(rcpt.blockNumber));
      await refreshDexState();
      const willCross = state.bestAsk > 0 && px >= state.bestAsk;
      showBanner(
        willCross
          ? `✅ BUY Order placed in Block #${fmtNum(ordBlk)} (crosses Best Ask ${state.bestAsk} ${escapeHtml(meta.quoteShort)}) — Backend Simulator will auto-clear on Block #${fmtNum(ordBlk + 1)}!`
          : `✅ Resting BUY Limit Order (${qty} ${escapeHtml(meta.baseSymbol)} @ ${px} ${escapeHtml(meta.quoteShort)}) escrowed in Block #${fmtNum(ordBlk)} — Backend Simulator will auto-ingest on Block #${fmtNum(ordBlk + 1)}!`,
        'ok'
      );
    } else {
      if (curShare < qty && el.chkAutoTopUp.checked && state.faucetHasBase) {
        const grantAmt = Math.max(500, qty - curShare + 200);
        await session.requestShareGrant(
          grantAmt,
          (msg) => showBanner(`🪙 Auto-Grant: ${escapeHtml(msg)}`, 'info'),
          meta.baseSymbol
        );
      } else if (curShare < qty && !state.faucetHasBase) {
        throw new Error(
          `Insufficient ${meta.baseSymbol} balance (${curShare} < ${qty}). Buy ${meta.baseSymbol} on this CLOB or underwrite via CorporateCharter first.`
        );
      }
      showBanner(
        `⏳ Signing <code>dexPlaceAsk(${px} ${escapeHtml(meta.quoteShort)}, ${qty} ${escapeHtml(meta.baseSymbol)})</code> &amp; escrowing ${fmtNum(qty)} ${escapeHtml(meta.baseSymbol)}…`,
        'info'
      );
      const rcpt = await session.sendAsMyIdentity(
        encodeAbi('dexPlaceAsk(address,uint64,uint64)', [
          ['address', session.inst.dexClob],
          ['uint64', px],
          ['uint64', qty],
        ]),
        `dexPlaceAsk(${qty}@${px})`,
        `DexClob(${meta.baseSymbol})`
      );
      const ordBlk = Number(BigInt(rcpt.blockNumber));
      await refreshDexState();
      const willCross = state.bestBid > 0 && px <= state.bestBid;
      showBanner(
        willCross
          ? `✅ SELL Order placed in Block #${fmtNum(ordBlk)} (crosses Best Bid ${state.bestBid} ${escapeHtml(meta.quoteShort)}) — Backend Simulator will auto-clear on Block #${fmtNum(ordBlk + 1)}!`
          : `✅ Resting SELL Limit Order (${qty} ${escapeHtml(meta.baseSymbol)} @ ${px} ${escapeHtml(meta.quoteShort)}) escrowed in Block #${fmtNum(ordBlk)} — Backend Simulator will auto-ingest on Block #${fmtNum(ordBlk + 1)}!`,
        'ok'
      );
    }
  } catch (err) {
    showBanner(`🚫 Order reverted: ${escapeHtml(err.message)}`, 'err');
  } finally {
    state.busy = false;
    el.btnSubmitOrder.disabled = false;
  }
});

syncViewVisibility();
await session.boot();
slxWatchChainApp({
  rpcUrl: () => session.rpcUrl,
  filter: {
    topics: [
      [
        GOV_CONSTANTS.TOPIC_ORDER_PLACED,
        GOV_CONSTANTS.TOPIC_BLOCK_MATCHED,
        GOV_CONSTANTS.TOPIC_ORDER_CANCELLED,
        IFRS_VALUATION_TOPICS.JOURNAL_POSTED,
        IFRS_VALUATION_TOPICS.SUBLEDGER_UPDATED,
        IFRS_VALUATION_TOPICS.PERIOD_CLOSED,
      ],
    ],
  },
  onLog: ingestDexSubscriptionLog,
  onRefresh: (meta) => refreshDexState(meta),
});
